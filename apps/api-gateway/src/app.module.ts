import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import {
  HttpExceptionFilter,
  RedisModule,
  RequestIdMiddleware,
  RpcToHttpExceptionFilter,
  TimeoutInterceptor,
  TransformInterceptor,
  createValidationPipe,
  gatewayEnvSchema,
} from '@app/common';
import { RedisCacheModule } from '@app/common/redis/redis-cache.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { ChatModule } from './chat/chat.module';
import { HealthModule } from './health/health.module';
import { AdminModule } from './admin/admin.module';
import { ProxyModule } from './infrastructure/proxy/proxy.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { OrganizationGuard } from './organizations/organization.guard';
import { OrganizationInterceptor } from './organizations/organization.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validationSchema: gatewayEnvSchema,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: { singleLine: true, colorize: true },
              }
            : undefined,
        autoLogging: process.env.NODE_ENV !== 'production',
        quietReqLogger: true,
      },
      forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
    }),
    RedisModule.register(),
    RedisCacheModule.register(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('THROTTLE_TTL_SECONDS', 60) * 1000,
            limit: config.get<number>('THROTTLE_LIMIT', 60),
          },
        ],
      }),
    }),
    StorageModule,
    ProxyModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    ChatModule, // HTTP + Socket.IO chat surface
    AdminModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_FILTER, useClass: RpcToHttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: OrganizationInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: OrganizationGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
