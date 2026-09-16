import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AUTH_PATTERNS, CHAT_PATTERNS, USER_PATTERNS } from '@app/contracts';
import type {
  AcceptInviteResult,
  AuthResult,
  AuthUserView,
  ForgotPasswordResult,
  InviteView,
  LoginResult,
  OrgSsoCredentialsView,
  PublicInviteView,
  RequestEmailVerificationResult,
  SessionView,
  Setup2faResult,
} from '@app/contracts';
import {
  AppException,
  AuthenticatedUser,
  BadRequestAppException,
  CurrentUser,
  Public,
  AUTH_SUCCESS_MESSAGES,
  PaginationQueryDto,
  type PaginatedResult,
} from '@app/common';
import { MicroserviceProxy } from '../infrastructure/proxy/microservice.proxy';
import { AuditLoggerService } from '../infrastructure/audit/audit-logger.service';
import { SkipOrg } from '../organizations/skip-org.decorator';
import {
  Confirm2faDto,
  CreateInviteDto,
  Disable2faDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  SessionRefreshTokenDto,
  Verify2faLoginDto,
  VerifyEmailDto,
} from './dto/auth-extra.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { TokenBlacklistService } from './token-blacklist.service';
import { AuthSessionCache } from './auth-session.cache';
import { SsoOidcService } from './sso-oidc.service';
import { SsoSamlService } from './sso-saml.service';
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
    private readonly ssoOidc: SsoOidcService,
    private readonly ssoSaml: SsoSamlService,
    private readonly audit: AuditLoggerService,
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
          const joinedAsGuest = result.organizations.some(
            (org) =>
              org.id === organizationId && org.role === 'guest',
          );
          if (!joinedAsGuest) {
            await this.proxy.sendChat(
              CHAT_PATTERNS.ENSURE_GENERAL_MEMBER,
              {
                userId: result.user.id,
                organizationId,
              },
              { skipTenant: true },
            );
          }
          if (result.pendingChannelId) {
            try {
              await this.proxy.sendChat(
                CHAT_PATTERNS.ENSURE_CHANNEL_MEMBER,
                {
                  userId: result.user.id,
                  conversationId: result.pendingChannelId,
                  organizationId,
                },
                { skipTenant: true },
              );
            } catch {
              // Channel may have been deleted; workspace join still succeeds.
            }
            await this.proxy
              .sendChat(
                CHAT_PATTERNS.MARK_SHARED_INVITE_ACCEPTED,
                {
                  conversationId: result.pendingChannelId,
                  email: result.user.email,
                  externalLabel: result.user.email,
                },
                { skipTenant: true },
              )
              .catch(() => undefined);
          }
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
    const orgId =
      result.activeOrganizationId ?? result.organizations[0]?.id ?? undefined;
    if (orgId) {
      this.audit.log({
        actorId: result.user.id,
        organizationId: orgId,
        action: 'auth.registered',
        targetType: 'user',
        targetId: result.user.id,
        meta: { viaInvite: Boolean(dto.inviteToken) },
      });
    }
    return { message: AUTH_SUCCESS_MESSAGES.REGISTERED, data: result };
  }

  @Public()
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @LoginDocs()
  async login(@Body() dto: LoginDto, @Req() request: Request) {
    const result = await this.proxy.sendAuth<LoginResult>(AUTH_PATTERNS.LOGIN, {
      ...dto,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    if (result && 'requires2fa' in result && result.requires2fa) {
      return {
        message: 'Two-factor authentication required',
        data: result,
      };
    }
    const auth = result as AuthResult;
    await this.sessionCache.set(auth.user);
    const orgId =
      auth.activeOrganizationId ?? auth.organizations[0]?.id ?? undefined;
    if (orgId) {
      this.audit.log({
        actorId: auth.user.id,
        organizationId: orgId,
        action: 'auth.login',
        targetType: 'user',
        targetId: auth.user.id,
        meta: { method: 'password' },
      });
    }
    return { message: AUTH_SUCCESS_MESSAGES.LOGGED_IN, data: auth };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login/2fa')
  @HttpCode(HttpStatus.OK)
  async verify2faLogin(
    @Body() dto: Verify2faLoginDto,
    @Req() request: Request,
  ) {
    const result = await this.proxy.sendAuth<AuthResult>(
      AUTH_PATTERNS.VERIFY_2FA_LOGIN,
      {
        tempToken: dto.tempToken,
        code: dto.code,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      },
    );
    await this.sessionCache.set(result.user);
    const orgId =
      result.activeOrganizationId ?? result.organizations[0]?.id ?? undefined;
    if (orgId) {
      this.audit.log({
        actorId: result.user.id,
        organizationId: orgId,
        action: 'auth.login',
        targetType: 'user',
        targetId: result.user.id,
        meta: { method: 'password_2fa' },
      });
    }
    return { message: AUTH_SUCCESS_MESSAGES.LOGGED_IN, data: result };
  }
  @HttpCode(HttpStatus.OK)
  async setup2fa(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.proxy.sendAuth<Setup2faResult>(
      AUTH_PATTERNS.SETUP_2FA,
      { userId: user.id },
    );
    return { message: 'Two-factor authentication setup started', data };
  }

  @Post('2fa/confirm')
  @HttpCode(HttpStatus.OK)
  async confirm2fa(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: Confirm2faDto,
  ) {
    const data = await this.proxy.sendAuth(AUTH_PATTERNS.CONFIRM_2FA, {
      userId: user.id,
      code: dto.code,
    });
    await this.sessionCache.invalidate(user.id);
    return { message: 'Two-factor authentication enabled', data };
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  async disable2fa(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: Disable2faDto,
  ) {
    const data = await this.proxy.sendAuth(AUTH_PATTERNS.DISABLE_2FA, {
      userId: user.id,
      password: dto.password,
      code: dto.code,
    });
    await this.sessionCache.invalidate(user.id);
    return { message: 'Two-factor authentication disabled', data };
  }

  @Get('sessions')
  async listSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SessionRefreshTokenDto,
    @Body() body: SessionRefreshTokenDto = {},
  ) {
    const data = await this.proxy.sendAuth<SessionView[]>(
      AUTH_PATTERNS.LIST_SESSIONS,
      {
        userId: user.id,
        currentRefreshToken: body.refreshToken ?? query.refreshToken,
      },
    );
    return { message: 'Sessions retrieved successfully', data };
  }

  @Delete('sessions/:id')
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.proxy.sendAuth(AUTH_PATTERNS.REVOKE_SESSION, {
      userId: user.id,
      sessionId: id,
    });
    return { message: 'Session revoked', data };
  }

  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  async revokeOtherSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SessionRefreshTokenDto = {},
  ) {
    const data = await this.proxy.sendAuth(
      AUTH_PATTERNS.REVOKE_OTHER_SESSIONS,
      {
        userId: user.id,
        currentRefreshToken: dto.refreshToken,
      },
    );
    return { message: 'Other sessions revoked', data };
  }

  @Public()
  @Get('sso/status')
  async ssoStatus(
    @Query('organizationId') organizationId?: string,
    @Query('slug') slug?: string,
  ) {
    if (!organizationId?.trim() && !slug?.trim()) {
      throw new BadRequestAppException('organizationId or slug is required');
    }
    const data = await this.ssoOidc.resolveCredentials({
      organizationId: organizationId?.trim(),
      slug: slug?.trim(),
    });
    return {
      message: 'SSO status',
      data: {
        organizationId: data.organizationId,
        slug: data.slug,
        name: data.name,
        ssoEnabled: data.ssoEnabled,
        ssoProvider: data.ssoProvider,
        configured: data.configured,
        hasClientSecret: data.hasClientSecret,
        plan: data.plan,
      },
    };
  }

  @Public()
  @Get('sso/:organizationId/start')
  async startSsoGet(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Query('returnPath') returnPath: string | undefined,
    @Res() res: Response,
  ) {
    const credentials = await this.ssoOidc.resolveCredentials({
      organizationId,
    });
    const url =
      credentials.ssoProvider === 'saml'
        ? await this.ssoSaml.buildAuthorizationRedirect({
            organizationId,
            returnPath,
          })
        : await this.ssoOidc.buildAuthorizationRedirect({
            organizationId,
            returnPath,
          });
    return res.redirect(url);
  }

  @Public()
  @Post('sso/:organizationId/start')
  async startSsoPost(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() body: { returnPath?: string } = {},
  ) {
    const credentials = await this.ssoOidc.resolveCredentials({
      organizationId,
    });
    const url =
      credentials.ssoProvider === 'saml'
        ? await this.ssoSaml.buildAuthorizationRedirect({
            organizationId,
            returnPath: body.returnPath,
          })
        : await this.ssoOidc.buildAuthorizationRedirect({
            organizationId,
            returnPath: body.returnPath,
          });
    return { message: 'SSO redirect ready', data: { url } };
  }

  @Public()
  @Get('sso/callback')
  async ssoCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Req() request: Request,
    @Res() res: Response,
  ) {
    const { redirectUrl } = await this.ssoOidc.handleCallback({
      code,
      state,
      error,
      errorDescription,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return res.redirect(redirectUrl);
  }

  @Public()
  @Get('sso/saml/:organizationId/metadata')
  async samlMetadata(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Res() res: Response,
  ) {
    const xml = await this.ssoSaml.getServiceProviderMetadata(organizationId);
    res.setHeader('Content-Type', 'application/samlmetadata+xml');
    return res.send(xml);
  }

  @Public()
  @Post('sso/saml/:organizationId/acs')
  async samlAcs(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() body: Record<string, string>,
    @Req() request: Request,
    @Res() res: Response,
  ) {
    const { redirectUrl } = await this.ssoSaml.handleAcs({
      organizationId,
      body,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return res.redirect(redirectUrl);
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
        role: dto.role === 'guest' ? 'guest' : 'member',
      },
    );
    this.audit.log({
      actorId: user.id,
      organizationId: orgId,
      action: 'invite.created',
      targetType: 'invite',
      targetId: data.id,
      meta: {
        email: data.email,
        role: data.role ?? 'member',
      },
    });
    return { message: AUTH_SUCCESS_MESSAGES.INVITE_CREATED, data };
  }

  @Get('invites')
  async listInvites(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
    @Headers('x-organization-id') organizationId?: string,
  ) {
    const orgId = organizationId?.trim();
    if (!orgId) {
      throw new BadRequestAppException(
        'X-Organization-Id header is required to list invites',
      );
    }
    const data = await this.proxy.sendAuth<PaginatedResult<InviteView>>(
      AUTH_PATTERNS.LIST_INVITES,
      {
        organizationId: orgId,
        requestedByUserId: user.id,
        page: query.page,
        limit: query.limit,
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
    // Guests only get channels they are explicitly invited to — never auto-join #general.
    if (data.role !== 'guest') {
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
    }

    if (data.pendingChannelId) {
      try {
        await this.proxy.sendChat(
          CHAT_PATTERNS.ENSURE_CHANNEL_MEMBER,
          {
            userId: user.id,
            conversationId: data.pendingChannelId,
            organizationId: data.organizationId,
          },
          { skipTenant: true },
        );
      } catch {
        // Channel may have been deleted; workspace join still succeeds.
      }
      await this.proxy
        .sendChat(
          CHAT_PATTERNS.MARK_SHARED_INVITE_ACCEPTED,
          {
            conversationId: data.pendingChannelId,
            email: user.email,
            externalLabel: user.email,
          },
          { skipTenant: true },
        )
        .catch(() => undefined);
    }

    this.audit.log({
      actorId: user.id,
      organizationId: data.organizationId,
      action: 'invite.accepted',
      targetType: 'organization',
      targetId: data.organizationId,
      meta: {
        role: data.role,
        alreadyMember: data.alreadyMember,
        pendingChannelId: data.pendingChannelId ?? null,
      },
    });

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
