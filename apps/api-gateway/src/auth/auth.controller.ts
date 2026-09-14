import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AUTH_PATTERNS, CHAT_PATTERNS, USER_PATTERNS } from '@app/contracts';
import type {
  AcceptInviteResult,
  AuthResult,
  AuthUserView,
  ForgotPasswordResult,
  InviteView,
  PublicInviteView,
  RequestEmailVerificationResult,
} from '@app/contracts';
import {
  AuthenticatedUser,
  BadRequestAppException,
  CurrentUser,
  Public,
  AUTH_SUCCESS_MESSAGES,
} from '@app/common';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { SkipOrg } from '../organizations/skip-org.decorator';
import {
  CreateInviteDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth-extra.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { TokenBlacklistService } from './token-blacklist.service';
import { AuthSessionCache } from './auth-session.cache';
import {
  AuthDocs,
  ChangePasswordDocs,
  LoginDocs,
  LogoutDocs,
  MeDocs,
  RefreshDocs,
  RegisterDocs,
} from './swagger/auth.swagger';

@AuthDocs()
@Controller('auth')
@SkipOrg()
export class AuthController {
  constructor(
    private readonly proxy: MicroserviceProxy,
    private readonly blacklist: TokenBlacklistService,
    private readonly sessionCache: AuthSessionCache,
  ) {}

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @RegisterDocs()
  async register(@Body() dto: RegisterDto) {
    const result = await this.proxy.sendAuth<AuthResult>(
      AUTH_PATTERNS.REGISTER,
      dto,
    );
    try {
      const organizationId =
        result.activeOrganizationId ?? result.organizations[0]?.id;
      if (organizationId) {
        await this.proxy.sendUser(
          USER_PATTERNS.CREATE_PROFILE,
          {
            userId: result.user.id,
            email: result.user.email,
            firstName: dto.firstName,
            lastName: dto.lastName,
            organizationId,
          },
          { skipTenant: true },
        );
        try {
          await this.proxy.sendChat(
            CHAT_PATTERNS.ENSURE_GENERAL_MEMBER,
            {
              userId: result.user.id,
              organizationId,
            },
            { skipTenant: true },
          );
        } catch {
          // #general may not exist yet for legacy orgs — invite still succeeds.
        }
      }
    } catch (error) {
      try {
        await this.proxy.sendAuth(AUTH_PATTERNS.DEACTIVATE, {
          userId: result.user.id,
        });
      } catch {
        // Compensation is best-effort so the original profile failure is still reported.
      }
      throw error;
    }
    await this.sessionCache.set(result.user);
    return { message: AUTH_SUCCESS_MESSAGES.REGISTERED, data: result };
  }

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @LoginDocs()
  async login(@Body() dto: LoginDto, @Req() request: Request) {
    const result = await this.proxy.sendAuth<AuthResult>(AUTH_PATTERNS.LOGIN, {
      ...dto,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    await this.sessionCache.set(result.user);
    return { message: AUTH_SUCCESS_MESSAGES.LOGGED_IN, data: result };
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RefreshDocs()
  async refresh(@Body() dto: RefreshTokenDto, @Req() request: Request) {
    const result = await this.proxy.sendAuth<AuthResult>(
      AUTH_PATTERNS.REFRESH,
      {
        refreshToken: dto.refreshToken,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      },
    );
    await this.sessionCache.set(result.user);
    return { message: AUTH_SUCCESS_MESSAGES.TOKEN_REFRESHED, data: result };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @LogoutDocs()
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Body() dto: LogoutDto = {},
  ) {
    const accessToken = request.headers.authorization?.replace('Bearer ', '');
    if (accessToken) {
      await this.blacklist.revokeAccessToken(accessToken);
    }
    await this.sessionCache.invalidate(user.id);

    await this.proxy.sendAuth(AUTH_PATTERNS.LOGOUT, {
      userId: user.id,
      refreshToken: dto.refreshToken,
      accessToken,
    });

    return {
      message: AUTH_SUCCESS_MESSAGES.LOGGED_OUT,
      data: { revoked: true },
    };
  }

  @Get('me')
  @MeDocs()
  async me(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.proxy.sendAuth<AuthUserView>(AUTH_PATTERNS.ME, {
      userId: user.id,
    });
    return { message: AUTH_SUCCESS_MESSAGES.PROFILE_FETCHED, data };
  }

  @Patch('password')
  @ChangePasswordDocs()
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Body() dto: ChangePasswordDto,
  ) {
    const data = await this.proxy.sendAuth(AUTH_PATTERNS.CHANGE_PASSWORD, {
      userId: user.id,
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
    });
    const accessToken = request.headers.authorization?.replace('Bearer ', '');
    if (accessToken) {
      await this.blacklist.revokeAccessToken(accessToken);
    }
    await this.sessionCache.invalidate(user.id);
    return { message: AUTH_SUCCESS_MESSAGES.PASSWORD_CHANGED, data };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    const data = await this.proxy.sendAuth<ForgotPasswordResult>(
      AUTH_PATTERNS.FORGOT_PASSWORD,
      { email: dto.email },
    );
    return { message: AUTH_SUCCESS_MESSAGES.PASSWORD_RESET_SENT, data };
  }

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    const data = await this.proxy.sendAuth(AUTH_PATTERNS.RESET_PASSWORD, {
      token: dto.token,
      password: dto.password,
    });
    return { message: AUTH_SUCCESS_MESSAGES.PASSWORD_RESET, data };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    const data = await this.proxy.sendAuth(AUTH_PATTERNS.VERIFY_EMAIL, {
      token: dto.token,
    });
    return { message: AUTH_SUCCESS_MESSAGES.EMAIL_VERIFIED, data };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  async resendVerification(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.proxy.sendAuth<RequestEmailVerificationResult>(
      AUTH_PATTERNS.REQUEST_EMAIL_VERIFICATION,
      { userId: user.id },
    );
    return { message: AUTH_SUCCESS_MESSAGES.VERIFICATION_SENT, data };
  }

  @Post('invites')
  @HttpCode(HttpStatus.CREATED)
  async createInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateInviteDto,
    @Headers('x-organization-id') organizationId?: string,
  ) {
    const orgId = organizationId?.trim();
    if (!orgId) {
      throw new BadRequestAppException(
        'X-Organization-Id header is required to invite teammates',
      );
    }
    const data = await this.proxy.sendAuth<InviteView>(
      AUTH_PATTERNS.CREATE_INVITE,
      {
        createdByUserId: user.id,
        organizationId: orgId,
        email: dto.email,
        expiresInDays: dto.expiresInDays,
        maxUses: dto.maxUses,
      },
    );
    return { message: AUTH_SUCCESS_MESSAGES.INVITE_CREATED, data };
  }

  @Get('invites')
  async listInvites(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('x-organization-id') organizationId?: string,
  ) {
    const orgId = organizationId?.trim();
    if (!orgId) {
      throw new BadRequestAppException(
        'X-Organization-Id header is required to list invites',
      );
    }
    const data = await this.proxy.sendAuth<InviteView[]>(
      AUTH_PATTERNS.LIST_INVITES,
      {
        organizationId: orgId,
        requestedByUserId: user.id,
      },
    );
    return { message: AUTH_SUCCESS_MESSAGES.INVITES_FETCHED, data };
  }

  @Public()
  @Get('invites/:token')
  async getInvite(@Param('token') token: string) {
    const data = await this.proxy.sendAuth<PublicInviteView>(
      AUTH_PATTERNS.GET_INVITE,
      { token },
    );
    return { message: AUTH_SUCCESS_MESSAGES.INVITE_FETCHED, data };
  }

  @SkipOrg()
  @Post('invites/:token/accept')
  @HttpCode(HttpStatus.OK)
  async acceptInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
  ) {
    const data = await this.proxy.sendAuth<AcceptInviteResult>(
      AUTH_PATTERNS.ACCEPT_INVITE,
      {
        userId: user.id,
        email: user.email,
        inviteToken: token,
      },
      { skipTenant: true },
    );

    const nameParts = (user.email.split('@')[0] || 'User').split(/[._-]/);
    try {
      await this.proxy.sendUser(
        USER_PATTERNS.CREATE_PROFILE,
        {
          userId: user.id,
          email: user.email,
          firstName: nameParts[0] || 'User',
          lastName: nameParts.slice(1).join(' ') || 'Account',
          organizationId: data.organizationId,
        },
        { skipTenant: true },
      );
    } catch {
      // Profile may already exist for this org.
    }
    try {
      await this.proxy.sendChat(
        CHAT_PATTERNS.ENSURE_GENERAL_MEMBER,
        {
          userId: user.id,
          organizationId: data.organizationId,
        },
        { skipTenant: true },
      );
    } catch {
      // #general may not exist for legacy orgs.
    }

    return { message: 'Joined workspace', data };
  }

  @Delete('invites/:id')
  async revokeInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('x-organization-id') organizationId?: string,
  ) {
    const orgId = organizationId?.trim();
    if (!orgId) {
      throw new BadRequestAppException(
        'X-Organization-Id header is required to revoke invites',
      );
    }
    const data = await this.proxy.sendAuth(AUTH_PATTERNS.REVOKE_INVITE, {
      inviteId: id,
      requestedByUserId: user.id,
      organizationId: orgId,
    });
    return { message: AUTH_SUCCESS_MESSAGES.INVITE_REVOKED, data };
  }
}
