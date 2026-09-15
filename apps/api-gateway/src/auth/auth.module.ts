import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthSessionCache } from './auth-session.cache';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenBlacklistService } from './token-blacklist.service';
import { SsoOidcService } from './sso-oidc.service';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
  controllers: [AuthController],
  providers: [
    TokenBlacklistService,
    AuthSessionCache,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    SsoOidcService,
  ],
  exports: [TokenBlacklistService, AuthSessionCache, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
