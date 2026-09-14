import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '@app/common';
import { AuthUser } from '../database/entities/auth-user.entity';
import { AuthToken } from '../database/entities/auth-token.entity';
import { RefreshToken } from '../database/entities/refresh-token.entity';
import { Organization } from '../database/entities/organization.entity';
import { OrganizationMember } from '../database/entities/organization-member.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { OrganizationService } from './organization.service';

@Module({
  imports: [
    MailModule,
    TypeOrmModule.forFeature([
      AuthUser,
      RefreshToken,
      AuthToken,
      Organization,
      OrganizationMember,
    ]),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthTokenService, OrganizationService],
})
export class AuthModule {}
