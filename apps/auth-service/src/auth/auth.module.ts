import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '@app/common';
import { AuthUser } from '../database/entities/auth-user.entity';
import { AuthToken } from '../database/entities/auth-token.entity';
import { RefreshToken } from '../database/entities/refresh-token.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';

@Module({
  imports: [
    MailModule,
    TypeOrmModule.forFeature([AuthUser, RefreshToken, AuthToken]),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthTokenService],
})
export class AuthModule {}
