import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
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
  CreateInvitePayload,
  DeactivatePayload,
  ForgotPasswordPayload,
  ForgotPasswordResult,
  GetInvitePayload,
  InviteView,
  ListInvitesPayload,
  LoginPayload,
  LogoutPayload,
  PublicInviteView,
  RefreshPayload,
  RegisterPayload,
  RequestEmailVerificationPayload,
  RequestEmailVerificationResult,
  ResetPasswordPayload,
  RevokeInvitePayload,
  TokenPair,
  ValidatePayload,
  VerifyEmailPayload,
} from '@app/contracts';
import { AuthUser } from '../database/entities/auth-user.entity';
import { RefreshToken } from '../database/entities/refresh-token.entity';
import { AuthTokenService } from './auth-token.service';
import { OrganizationService } from './organization.service';

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
    let emailVerified = false;
    if (payload.inviteToken) {
      const invite = await this.authTokens.assertInviteForRegister(
        payload.inviteToken,
        email,
      );
      inviteId = invite.id;
      inviteOrganizationId = invite.organizationId;
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
          role: 'member',
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
        };
      }
      return authResult;
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        return RpcErrors.conflict('An account with this email already exists');
      }
      throw error;
    }
  }

  async login(payload: LoginPayload): Promise<AuthResult> {
    const email = payload.email.toLowerCase().trim();
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.password')
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

    const tokens = await this.issueTokens(user, payload.ip, payload.userAgent);
    return this.toAuthResult(user, tokens);
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
        role: 'member',
      });
      await this.authTokens.consumeInvite(invite.id);
    }

    const organizations = await this.organizations.listForUser({
      userId: user.id,
    });
    return {
      organizationId,
      organizations,
      activeOrganizationId: organizationId,
      alreadyMember,
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

  async listInvites(payload: ListInvitesPayload): Promise<InviteView[]> {
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
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }
}
