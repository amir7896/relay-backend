import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { authEnvSchema } from '@app/common';
import { createTypeOrmOptions } from '@app/database';
import { AuthModule } from './auth/auth.module';
import { AuthUser } from './database/entities/auth-user.entity';
import { AuthToken } from './database/entities/auth-token.entity';
import { RefreshToken } from './database/entities/refresh-token.entity';
import { Organization } from './database/entities/organization.entity';
import { OrganizationMember } from './database/entities/organization-member.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
      validationSchema: authEnvSchema,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createTypeOrmOptions({
          host: config.getOrThrow<string>('POSTGRES_HOST'),
          port: config.get<number>('POSTGRES_PORT', 5432),
          username: config.getOrThrow<string>('POSTGRES_USER'),
          password: config.getOrThrow<string>('POSTGRES_PASSWORD'),
          database: config.getOrThrow<string>('AUTH_POSTGRES_DATABASE'),
          entities: [
            AuthUser,
            RefreshToken,
            AuthToken,
            Organization,
            OrganizationMember,
          ],
          poolMax: config.get<number>('POSTGRES_POOL_MAX', 20),
          poolMin: config.get<number>('POSTGRES_POOL_MIN', 2),
        }),
    }),
    AuthModule,
  ],
})
export class AppModule {}
