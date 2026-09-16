import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { QueryFailedError, Repository } from 'typeorm';
import {
  MailService,
  UserRole,
  hashPassword,
  parseDurationMs,
  verifyPassword,
  RpcErrors,
} from '@app/common';
import {
  AuthResult,
  AuthUserView,
  AcceptInvitePayload,
  AcceptInviteResult,
  ChangePasswordPayload,
  Confirm2faPayload,
  CreateInvitePayload,
  DeactivatePayload,
  Disable2faPayload,
  ForgotPasswordPayload,
  ForgotPasswordResult,
  GetInvitePayload,
  InviteView,
  ListInvitesPayload,
  ListSessionsPayload,
  LoginPayload,
  LoginResult,
  LogoutPayload,
  OrgMemberRole,
  PublicInviteView,
  RefreshPayload,
  RegisterPayload,
  RequestEmailVerificationPayload,
  RequestEmailVerificationResult,
  ResetPasswordPayload,
  RevokeInvitePayload,
  RevokeOtherSessionsPayload,
  RevokeSessionPayload,
  SessionView,
  Setup2faPayload,
  Setup2faResult,
  SsoCompletePayload,
  TokenPair,
  ValidatePayload,
  Verify2faLoginPayload,
  VerifyEmailPayload,
} from '@app/contracts';
import { AuthUser } from '../database/entities/auth-user.entity';
import { RefreshToken } from '../database/entities/refresh-token.entity';
import { AuthTokenService } from './auth-token.service';
import { OrganizationService } from './organization.service';
import {
  buildOtpAuthUrl,
  generateTotpSecret,
  verifyTotpCode,
} from './totp.util';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(AuthUser)
    private readonly users: Repository<AuthUser>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly authTokens: AuthTokenService,
    private readonly mail: MailService,
    private readonly organizations: OrganizationService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureAdmin();
    await this.organizations.ensureDefaultOrganization();
  }

  async register(payload: RegisterPayload): Promise<AuthResult> {
    const email = payload.email.toLowerCase().trim();
    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      return RpcErrors.conflict('An account with this email already exists');
    }

    let inviteId: string | null = null;
    let inviteOrganizationId: string | null = null;
    let inviteRole: 'member' | 'guest' = 'member';
    let pendingChannelId: string | null = null;
    let emailVerified = false;
    if (payload.inviteToken) {
      const invite = await this.authTokens.assertInviteForRegister(
        payload.inviteToken,
        email,
      );
      inviteId = invite.id;
      inviteOrganizationId = invite.organizationId;
      inviteRole = invite.inviteRole === 'guest' ? 'guest' : 'member';
      pendingChannelId = invite.pendingChannelId ?? null;
      emailVerified = Boolean(invite.email && invite.email === email);
    }

    const user = this.users.create({
      email,
      password: await hashPassword(payload.password),
      role: UserRole.USER,
      isActive: true,
      isEmailVerified: emailVerified,
    });

    try {
      const saved = await this.users.save(user);
      if (inviteId && inviteOrganizationId) {
        await this.organizations.addMemberDirect({
          organizationId: inviteOrganizationId,
          userId: saved.id,
          role: inviteRole,
        });
        await this.authTokens.consumeInvite(inviteId);
      } else if (inviteId) {
        await this.authTokens.consumeInvite(inviteId);
      }
      const tokens = await this.issueTokens(saved);
      if (!saved.isEmailVerified) {
        void this.authTokens
          .requestEmailVerification(saved.id)
          .catch((error: unknown) => {
            this.logger.warn(
              `Could not send verification email: ${
                error instanceof Error ? error.message : 'unknown'
              }`,
            );
          });
      }
      // Invite joins that workspace; otherwise Slack-style onboarding creates one.
      const authResult = await this.toAuthResult(saved, tokens);
      if (
        inviteOrganizationId &&
        authResult.organizations.some((org) => org.id === inviteOrganizationId)
      ) {
        return {
          ...authResult,
          activeOrganizationId: inviteOrganizationId,
          pendingChannelId,
        };
      }
      return { ...authResult, pendingChannelId };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        return RpcErrors.conflict('An account with this email already exists');
      }
      throw error;
    }
  }

  async login(payload: LoginPayload): Promise<LoginResult> {
    const email = payload.email.toLowerCase().trim();
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.password')
      .addSelect('user.totpSecret')
      .where('user.email = :email', { email })
      .getOne();

    if (!user) {
      return RpcErrors.unauthorized('Invalid email or password');
    }

    const passwordMatches = await verifyPassword(
      payload.password,
      user.password,
    );
    if (!passwordMatches) {
      return RpcErrors.unauthorized('Invalid email or password');
    }

    if (!user.isActive) {
      return RpcErrors.forbidden('This account has been deactivated');
    }

    if (user.totpEnabled) {
      const tempToken = await this.jwt.signAsync(
        { sub: user.id, type: '2fa_pending' },
        {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
          expiresIn: '5m',
        },
      );
      return {
        requires2fa: true,
        tempToken,
        userId: user.id,
        email: user.email,
      };
    }

    const tokens = await this.issueTokens(user, payload.ip, payload.userAgent);
    return this.toAuthResult(user, tokens);
  }

  async verify2faLogin(payload: Verify2faLoginPayload): Promise<AuthResult> {
    let decoded: { sub?: string; type?: string };
    try {
      decoded = this.jwt.verify<{ sub?: string; type?: string }>(
        payload.tempToken,
        {
          secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        },
      );
    } catch {
      return RpcErrors.unauthorized('2FA session expired or invalid');
    }

    if (decoded.type !== '2fa_pending' || !decoded.sub) {
      return RpcErrors.unauthorized('2FA session expired or invalid');
    }

    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.totpSecret')
      .where('user.id = :id', { id: decoded.sub })
      .getOne();

    if (!user || !user.isActive) {
      return RpcErrors.unauthorized('Account is not available');
    }
    if (!user.totpEnabled || !user.totpSecret) {
      return RpcErrors.badRequest('2FA is not enabled for this account');
    }
    if (!verifyTotpCode(user.totpSecret, payload.code)) {
      return RpcErrors.unauthorized('Invalid authenticator code');
    }

    const tokens = await this.issueTokens(user, payload.ip, payload.userAgent);
    return this.toAuthResult(user, tokens);
  }

  async setup2fa(payload: Setup2faPayload): Promise<Setup2faResult> {
    const user = await this.users.findOne({ where: { id: payload.userId } });
    if (!user) {
      return RpcErrors.notFound('User');
    }
    if (user.totpEnabled) {
      return RpcErrors.conflict('Two-factor authentication is already enabled');
    }

    const secret = generateTotpSecret();
    user.totpSecret = secret;
    await this.users.save(user);

    return {
      secret,
      otpauthUrl: buildOtpAuthUrl(secret, user.email),
    };
  }

  async confirm2fa(
    payload: Confirm2faPayload,
  ): Promise<{ enabled: boolean }> {
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.totpSecret')
      .where('user.id = :id', { id: payload.userId })
      .getOne();

    if (!user) {
      return RpcErrors.notFound('User');
    }
    if (!user.totpSecret) {
      return RpcErrors.badRequest('Set up 2FA before confirming');
    }
    if (user.totpEnabled) {
      return RpcErrors.conflict('Two-factor authentication is already enabled');
    }
    if (!verifyTotpCode(user.totpSecret, payload.code)) {
      return RpcErrors.unauthorized('Invalid authenticator code');
    }

    user.totpEnabled = true;
    await this.users.save(user);
    return { enabled: true };
  }

  async disable2fa(
    payload: Disable2faPayload,
  ): Promise<{ disabled: boolean }> {
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.password')
      .addSelect('user.totpSecret')
      .where('user.id = :id', { id: payload.userId })
      .getOne();

    if (!user) {
      return RpcErrors.notFound('User');
    }

    if (!(await verifyPassword(payload.password, user.password))) {
      return RpcErrors.unauthorized('Password is incorrect');
    }

    if (user.totpEnabled) {
      if (
        !payload.code ||
        !user.totpSecret ||
        !verifyTotpCode(user.totpSecret, payload.code)
      ) {
        return RpcErrors.unauthorized('Invalid authenticator code');
      }
    }

    user.totpSecret = null;
    user.totpEnabled = false;
    await this.users.save(user);
    return { disabled: true };
  }

  async listSessions(payload: ListSessionsPayload): Promise<SessionView[]> {
    const tokens = await this.refreshTokens
      .createQueryBuilder('token')
      .where('token.userId = :userId', { userId: payload.userId })
      .andWhere('token.revoked = false')
      .andWhere('token.expiresAt > :now', { now: new Date() })
      .orderBy('token.createdAt', 'DESC')
      .getMany();

    const currentHash = payload.currentRefreshToken
      ? this.hashToken(payload.currentRefreshToken)
      : null;

    return tokens.map((token) => ({
      id: token.id,
      userAgent: token.userAgent,
      ip: token.ip,
      createdAt: token.createdAt.toISOString(),
      expiresAt: token.expiresAt.toISOString(),
      current: currentHash ? token.tokenHash === currentHash : false,
    }));
  }

  async revokeSession(
    payload: RevokeSessionPayload,
  ): Promise<{ revoked: boolean }> {
    const token = await this.refreshTokens.findOne({
      where: { id: payload.sessionId, userId: payload.userId },
    });
    if (!token) {
      return RpcErrors.notFound('Session');
    }
    if (!token.revoked) {
      token.revoked = true;
      await this.refreshTokens.save(token);
    }
    return { revoked: true };
  }

  async revokeOtherSessions(
    payload: RevokeOtherSessionsPayload,
  ): Promise<{ revoked: number }> {
    const qb = this.refreshTokens
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revoked: true })
      .where('userId = :userId', { userId: payload.userId })
      .andWhere('revoked = false');

    if (payload.currentRefreshToken) {
      qb.andWhere('tokenHash != :currentHash', {
        currentHash: this.hashToken(payload.currentRefreshToken),
      });
    }

    const result = await qb.execute();
    return { revoked: result.affected ?? 0 };
  }

  async acceptInvite(payload: AcceptInvitePayload): Promise<AcceptInviteResult> {
    const email = payload.email.toLowerCase().trim();
    const user = await this.users.findOne({ where: { id: payload.userId } });
    if (!user || !user.isActive) {
      return RpcErrors.unauthorized('Account is not available');
    }
    if (user.email.toLowerCase() !== email) {
      return RpcErrors.forbidden('Signed-in email does not match this account');
    }

    const invite = await this.authTokens.assertInviteForRegister(
      payload.inviteToken,
      email,
    );
    const organizationId = invite.organizationId!;
    const alreadyMember = await this.organizations.isMember({
      organizationId,
      userId: user.id,
    });
    if (!alreadyMember) {
      await this.organizations.addMemberDirect({
        organizationId,
        userId: user.id,
        role: invite.inviteRole === 'guest' ? 'guest' : 'member',
      });
      await this.authTokens.consumeInvite(invite.id);
    }

    const organizations = await this.organizations.listForUser({
      userId: user.id,
    });
    const role: OrgMemberRole =
      organizations.find((org) => org.id === organizationId)?.role ??
      (invite.inviteRole === 'guest' ? 'guest' : 'member');
    return {
      organizationId,
      organizations,
      activeOrganizationId: organizationId,
      alreadyMember,
      role,
      pendingChannelId: invite.pendingChannelId ?? null,
    };
  }

  /**
   * Complete OIDC SSO: find-or-create user by email, ensure org membership, issue tokens.
   */
  async ssoComplete(payload: SsoCompletePayload): Promise<AuthResult> {
    const email = payload.email.toLowerCase().trim();
    if (!email || !email.includes('@')) {
      return RpcErrors.badRequest('SSO email is required');
    }

    const org = await this.organizations.getSsoCredentials(
      payload.organizationId,
    );
    if (!org.configured || !org.ssoEnabled) {
      return RpcErrors.badRequest('SSO is not configured for this workspace');
    }

    let user = await this.users.findOne({ where: { email } });
    if (!user) {
      user = await this.users.save(
        this.users.create({
          email,
          password: await hashPassword(randomBytes(32).toString('hex')),
          role: UserRole.USER,
          isActive: true,
          isEmailVerified: payload.emailVerified !== false,
        }),
      );
    }

    if (!user.isActive) {
      return RpcErrors.forbidden('This account has been deactivated');
    }

    if (payload.emailVerified !== false && !user.isEmailVerified) {
      user.isEmailVerified = true;
      await this.users.save(user);
    }

    await this.organizations.addMemberDirect({
      organizationId: payload.organizationId,
      userId: user.id,
      role: 'member',
    });

    const tokens = await this.issueTokens(
      user,
      payload.ip,
      payload.userAgent,
    );
    const authResult = await this.toAuthResult(user, tokens);
    return {
      ...authResult,
      activeOrganizationId: payload.organizationId,
    };
  }

  async refresh(payload: RefreshPayload): Promise<AuthResult> {
    const tokenHash = this.hashToken(payload.refreshToken);

    try {
      const decoded = this.jwt.verify<{ type?: string }>(payload.refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
      if (decoded.type !== 'refresh') {
        return RpcErrors.unauthorized('Refresh token is invalid or expired');
      }
    } catch {
      return RpcErrors.unauthorized('Refresh token is invalid or expired');
    }

    return this.refreshTokens.manager.transaction(async (manager) => {
      const stored = await manager
        .getRepository(RefreshToken)
        .createQueryBuilder('token')
        .innerJoinAndSelect('token.user', 'user')
        .where('token.tokenHash = :tokenHash', { tokenHash })
        .setLock('pessimistic_write')
        .getOne();

      if (
        !stored ||
        stored.revoked ||
        stored.expiresAt.getTime() < Date.now()
      ) {
        return RpcErrors.unauthorized('Refresh token is invalid or expired');
      }

      if (!stored.user.isActive) {
        return RpcErrors.forbidden('This account has been deactivated');
      }

      stored.revoked = true;
      await manager.save(stored);

      const tokens = await this.issueTokens(
        stored.user,
        payload.ip,
        payload.userAgent,
        manager.getRepository(RefreshToken),
      );
      return this.toAuthResult(stored.user, tokens);
    });
  }

  async logout(payload: LogoutPayload): Promise<{ revoked: boolean }> {
    if (payload.refreshToken) {
      const tokenHash = this.hashToken(payload.refreshToken);
      await this.refreshTokens.update(
        { tokenHash, userId: payload.userId },
        { revoked: true },
      );
    } else {
      await this.refreshTokens.update(
        { userId: payload.userId, revoked: false },
        { revoked: true },
      );
    }
    return { revoked: true };
  }

  async validate(payload: ValidatePayload): Promise<AuthUserView> {
    const user = await this.users.findOne({ where: { id: payload.userId } });
    if (!user) {
      return RpcErrors.unauthorized('User session is no longer valid');
    }
    if (!user.isActive) {
      return RpcErrors.forbidden('This account has been deactivated');
    }
    return this.toView(user);
  }

  async me(userId: string): Promise<AuthUserView> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      return RpcErrors.notFound('User');
    }
    return this.toView(user);
  }

  async changePassword(
    payload: ChangePasswordPayload,
  ): Promise<{ changed: boolean }> {
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.id = :id', { id: payload.userId })
      .getOne();

    if (!user) {
      return RpcErrors.notFound('User');
    }

    if (!(await verifyPassword(payload.currentPassword, user.password))) {
      return RpcErrors.unauthorized('Current password is incorrect');
    }

    user.password = await hashPassword(payload.newPassword);
    await this.users.save(user);
    await this.refreshTokens.update(
      { userId: user.id, revoked: false },
      { revoked: true },
    );

    return { changed: true };
  }

  async forgotPassword(
    payload: ForgotPasswordPayload,
  ): Promise<ForgotPasswordResult> {
    return this.authTokens.forgotPassword(payload.email);
  }

  async resetPassword(
    payload: ResetPasswordPayload,
  ): Promise<{ reset: boolean }> {
    const result = await this.authTokens.resetPassword(
      payload.token,
      await hashPassword(payload.password),
    );
    await this.refreshTokens.update(
      { userId: result.userId, revoked: false },
      { revoked: true },
    );
    return { reset: true };
  }

  async requestEmailVerification(
    payload: RequestEmailVerificationPayload,
  ): Promise<RequestEmailVerificationResult> {
    return this.authTokens.requestEmailVerification(payload.userId);
  }

  async verifyEmail(
    payload: VerifyEmailPayload,
  ): Promise<{ verified: boolean }> {
    return this.authTokens.verifyEmail(payload.token);
  }

  async createInvite(payload: CreateInvitePayload): Promise<InviteView> {
    return this.authTokens.createInvite(payload);
  }

  async listInvites(payload: ListInvitesPayload) {
    return this.authTokens.listInvites(payload);
  }

  async getInvite(payload: GetInvitePayload): Promise<PublicInviteView> {
    return this.authTokens.getInvite(payload.token);
  }

  async revokeInvite(
    payload: RevokeInvitePayload,
  ): Promise<{ revoked: boolean }> {
    return this.authTokens.revokeInvite(payload);
  }

  async deactivate(
    payload: DeactivatePayload,
  ): Promise<{ deactivated: boolean }> {
    const user = await this.users.findOne({ where: { id: payload.userId } });
    if (!user) {
      return RpcErrors.notFound('User');
    }

    user.isActive = false;
    await this.users.save(user);
    await this.refreshTokens.update(
      { userId: user.id, revoked: false },
      { revoked: true },
    );
    await this.users.softRemove(user);
    return { deactivated: true };
  }

  private async ensureAdmin(): Promise<void> {
    const email = this.config.get<string>('ADMIN_EMAIL')?.toLowerCase().trim();
    const password = this.config.get<string>('ADMIN_PASSWORD');
    if (!email) {
      return;
    }

    const existing = await this.users.findOne({ where: { email } });
    if (existing) {
      if (existing.role !== UserRole.ADMIN) {
        existing.role = UserRole.ADMIN;
        await this.users.save(existing);
        this.logger.log(
          `Promoted ${email} to admin. Log in again to get a new access token.`,
        );
      }
      return;
    }

    if (!password) {
      this.logger.warn(
        `ADMIN_EMAIL=${email} was set but the user does not exist and ADMIN_PASSWORD is empty`,
      );
      return;
    }

    const user = this.users.create({
      email,
      password: await hashPassword(password),
      role: UserRole.ADMIN,
      isActive: true,
      isEmailVerified: true,
    });
    await this.users.save(user);
    this.logger.log(`Created admin account ${email}`);
  }

  private async issueTokens(
    user: AuthUser,
    ip?: string,
    userAgent?: string,
    tokens = this.refreshTokens,
  ): Promise<TokenPair> {
    const accessExpiresIn = this.config.get<string>(
      'JWT_ACCESS_EXPIRES_IN',
      '1d',
    );
    const refreshExpiresIn = this.config.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    );

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role, type: 'access' },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
      },
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role, type: 'refresh' },
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshExpiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
        jwtid: randomUUID(),
      },
    );

    const entity = tokens.create({
      userId: user.id,
      tokenHash: this.hashToken(refreshToken),
      expiresAt: new Date(Date.now() + parseDurationMs(refreshExpiresIn)),
      userAgent: userAgent ?? null,
      ip: ip ?? null,
    });
    await tokens.save(entity);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: accessExpiresIn,
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private isUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) {
      return false;
    }
    const driver = error.driverError as { code?: string } | undefined;
    return driver?.code === '23505';
  }

  private async toAuthResult(
    user: AuthUser,
    tokens: TokenPair,
  ): Promise<AuthResult> {
    const organizations = await this.organizations.listForUser({
      userId: user.id,
    });
    const activeOrganizationId =
      organizations.find((org) => org.isDefault)?.id ??
      organizations[0]?.id ??
      null;
    return {
      user: this.toView(user),
      tokens,
      organizations,
      activeOrganizationId,
    };
  }

  private toView(user: AuthUser): AuthUserView {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      isEmailVerified: user.isEmailVerified,
      totpEnabled: Boolean(user.totpEnabled),
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
