import cluster from 'node:cluster';
import os from 'node:os';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import compression from 'compression';
import { config as loadEnv } from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';
import {
  ApiErrorResponseSchema,
  ApiSuccessEnvelopeSchema,
  PaginationMetaSchema,
} from '@app/common';
import {
  AuthResultSchema,
  AuthUserSchema,
  TokenPairSchema,
} from './auth/swagger/auth.schema';
import { AppModule } from './app.module';
import {
  HealthInfoSchema,
  RabbitMqHealthSchema,
  RedisHealthSchema,
} from './health/swagger/health.schema';
import {
  ConversationSchema,
  MessageSchema,
  PresenceSchema,
} from './chat/swagger/chat.schema';
import { RedisIoAdapter } from './infrastructure/socket/redis-io.adapter';
import { StorageService } from './storage/storage.service';
import { UserProfileSchema } from './users/swagger/users.schema';

loadEnv();

function gatewayWorkers(): number {
  const raw = Number(process.env.GATEWAY_WORKERS ?? 1);
  if (raw === 0) {
    return Math.max(1, os.cpus().length);
  }
  return Math.max(1, Number.isFinite(raw) ? raw : 1);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  const config = app.get(ConfigService);
  const logger = new Logger('ApiGateway');

  app.useLogger(app.get(PinoLogger));
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: true, limit: '64kb' }));
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());

  const origin = config.get<string>('CORS_ORIGIN', '*');
  app.enableCors({
    origin:
      origin === '*' ? true : origin.split(',').map((item) => item.trim()),
    credentials: true,
  });

  const storage = app.get(StorageService);
  const localUploadsRoot = storage.getLocalRoot();
  if (localUploadsRoot) {
    app.use('/uploads', express.static(localUploadsRoot));
    logger.log(`Serving local uploads from ${localUploadsRoot}`);
  } else {
    logger.log(`Cloud file storage active (${storage.driver})`);
  }

  const prefix = config.get<string>('GATEWAY_GLOBAL_PREFIX', 'api');
  app.setGlobalPrefix(prefix);
  app.enableShutdownHooks();

  const http = app.getHttpAdapter().getInstance() as {
    set: (key: string, value: unknown) => void;
    get: (
      path: string,
      handler: (
        req: unknown,
        res: { redirect: (status: number, url: string) => void },
      ) => void,
    ) => void;
  };
  http.set('trust proxy', 1);

  const redisIoAdapter = new RedisIoAdapter(app);
  try {
    await redisIoAdapter.connectToRedis();
    app.useWebSocketAdapter(redisIoAdapter);
    logger.log('Socket.IO Redis adapter enabled');
  } catch (error) {
    logger.warn(
      `Socket.IO Redis adapter unavailable (${error instanceof Error ? error.message : 'unknown'}); single-instance mode`,
    );
  }

  if (
    config.get<boolean>(
      'SWAGGER_ENABLED',
      process.env.NODE_ENV !== 'production',
    )
  ) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('NestJS Microservices API')
      .setDescription(
        'API Gateway for Auth, User, and Chat microservices. Authentication uses JWT. Chat also uses a Socket.IO namespace at `/chat`. Inter-service traffic is brokered through RabbitMQ. Redis is used for cache, token blacklist, presence, and Socket.IO scale-out.',
      )
      .setVersion('1.0.0')
      .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Paste the access token from /auth/login',
      })
      .addTag('Auth')
      .addTag('Users')
      .addTag('Chat')
      .addTag('Health')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig, {
      extraModels: [
        ApiSuccessEnvelopeSchema,
        ApiErrorResponseSchema,
        PaginationMetaSchema,
        AuthUserSchema,
        AuthResultSchema,
        TokenPairSchema,
        UserProfileSchema,
        ConversationSchema,
        MessageSchema,
        PresenceSchema,
        HealthInfoSchema,
        RabbitMqHealthSchema,
        RedisHealthSchema,
      ],
    });
    SwaggerModule.setup(`${prefix}/docs`, app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const docsPath = `/${prefix}/docs`;
  for (const from of ['/', `/${prefix}`, '/api-docs']) {
    http.get(from, (_req, res) => {
      res.redirect(302, docsPath);
    });
  }

  const port = config.get<number>('GATEWAY_PORT', 3002);
  await app.listen(port);
  logger.log(`API Gateway running on http://localhost:${port}/${prefix}`);
  logger.log(`Swagger docs available at http://localhost:${port}${docsPath}`);
}

const workers = gatewayWorkers();
if (cluster.isPrimary && workers > 1) {
  const logger = new Logger('ApiGateway');
  logger.log(`Starting ${workers} gateway workers`);
  for (let i = 0; i < workers; i += 1) {
    cluster.fork();
  }
  cluster.on('exit', (worker) => {
    logger.warn(`Worker ${worker.process.pid} exited; restarting`);
    cluster.fork();
  });
} else {
  void bootstrap();
}
