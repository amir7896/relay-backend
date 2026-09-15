import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { MailService, RpcErrors } from '@app/common';
import type {
  CreateInvitePayload,
  ForgotPasswordResult,
  InviteView,
  ListInvitesPayload,
  PublicInviteView,
  RequestEmailVerificationResult,
  RevokeInvitePayload,
} from '@app/contracts';
import {
  AuthToken,
  AuthTokenType,
} from '../database/entities/auth-token.entity';
import { AuthUser } from '../database/entities/auth-user.entity';
import { Organization } from '../database/entities/organization.entity';
import { OrganizationService } from './organization.service';

@Injectable()
export class AuthTokenService {
  private readonly logger = new Logger(AuthTokenService.name);

  constructor(
    @InjectRepository(AuthToken)
    private readonly tokens: Repository<AuthToken>,
    @InjectRepository(AuthUser)
    private readonly users: Repository<AuthUser>,
    @InjectRepository(Organization)
    private readonly organizations: Repository<Organization>,
    private readonly organizationService: OrganizationService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async requestEmailVerification(
    userId: string,
  ): Promise<RequestEmailVerificationResult> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      return RpcErrors.notFound('User');
    }
    if (user.isEmailVerified) {
      return { sent: false };
    }

    const raw = await this.issueToken({
      type: AuthTokenType.EMAIL_VERIFY,
      email: user.email,
      userId: user.id,
      ttlMs: this.ttlMs('EMAIL_VERIFY_TTL_HOURS', 48),
    });

    const verifyUrl = `${this.mail.publicAppUrl}/verify-email?token=${raw}`;
    const result = await this.mail.send({
      to: user.email,
      subject: 'Verify your Relay email',
      text: `Verify your email by opening this link:\n${verifyUrl}\n\nThis link expires in 48 hours.`,
      html: `<p>Verify your email by opening this link:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 48 hours.</p>`,
    });

    return {
      sent: true,
      debugVerifyUrl:
        result.previewUrl ?? (result.delivered ? undefined : verifyUrl),
    };
  }

  async verifyEmail(token: string): Promise<{ verified: boolean }> {
    const record = await this.consumeToken(token, AuthTokenType.EMAIL_VERIFY);
    if (!record.userId) {
      return RpcErrors.badRequest('Verification token is invalid');
    }
    const user = await this.users.findOne({ where: { id: record.userId } });
    if (!user) {
      return RpcErrors.notFound('User');
    }
    user.isEmailVerified = true;
    await this.users.save(user);
    return { verified: true };
  }

  async forgotPassword(emailRaw: string): Promise<ForgotPasswordResult> {
    const email = emailRaw.toLowerCase().trim();
    const user = await this.users.findOne({ where: { email } });
    if (!user || !user.isActive) {
      return { accepted: true };
    }

    const raw = await this.issueToken({
      type: AuthTokenType.PASSWORD_RESET,
      email: user.email,
      userId: user.id,
      ttlMs: this.ttlMs('PASSWORD_RESET_TTL_HOURS', 2),
    });

    const resetUrl = `${this.mail.publicAppUrl}/reset-password?token=${raw}`;
    const result = await this.mail.send({
      to: user.email,
      subject: 'Reset your Relay password',
      text: `Reset your password by opening this link:\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
      html: `<p>Reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you did not request this, ignore this email.</p>`,
    });

    return {
      accepted: true,
      debugResetUrl:
        result.previewUrl ?? (result.delivered ? undefined : resetUrl),
    };
  }

  async resetPassword(
    token: string,
    passwordHash: string,
  ): Promise<{ reset: boolean; userId: string }> {
    const record = await this.consumeToken(token, AuthTokenType.PASSWORD_RESET);
    if (!record.userId) {
      return RpcErrors.badRequest('Reset token is invalid');
    }
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.id = :id', { id: record.userId })
      .getOne();
    if (!user) {
      return RpcErrors.notFound('User');
    }
    user.password = passwordHash;
    await this.users.save(user);
    return { reset: true, userId: user.id };
  }

  async createInvite(payload: CreateInvitePayload): Promise<InviteView> {
    const org = await this.organizationService.requireOrgAdmin({
      organizationId: payload.organizationId,
      userId: payload.createdByUserId,
    });

    await this.organizationService.assertSeatAvailable(
      payload.organizationId,
      { role: payload.role === 'guest' ? 'guest' : 'member' },
    );

    const email = payload.email?.toLowerCase().trim() || null;
    if (email) {
      const existing = await this.users.findOne({ where: { email } });
      if (existing) {
        const alreadyMember = await this.organizationService.isMember({
          organizationId: payload.organizationId,
          userId: existing.id,
        });
        if (alreadyMember) {
          return RpcErrors.conflict('That person is already in this workspace');
        }
      }
    }

    const days = Math.min(Math.max(payload.expiresInDays ?? 7, 1), 90);
    const maxUses = email
      ? 1
      : Math.min(Math.max(payload.maxUses ?? 25, 1), 500);
    const inviteRole = payload.role === 'guest' ? 'guest' : 'member';
    const raw = await this.issueToken({
      type: AuthTokenType.INVITE,
      email,
      userId: null,
      createdByUserId: payload.createdByUserId,
      organizationId: payload.organizationId,
      inviteRole,
      maxUses,
      ttlMs: days * 24 * 60 * 60 * 1000,
    });

    const saved = await this.tokens.findOneOrFail({
      where: { tokenHash: this.hash(raw) },
    });
    const view = this.toInviteView(saved, raw, org.name);

    if (email) {
      const mailResult = await this.mail.send({
        to: email,
        subject: `You're invited to ${org.name} on Relay`,
        text: `Join ${org.name} on Relay:\n${view.inviteUrl}\n\nThis link expires on ${view.expiresAt}.`,
        html: `<p>You are invited to <strong>${org.name}</strong> on Relay.</p><p><a href="${view.inviteUrl}">Accept invite</a></p><p>Expires: ${view.expiresAt}</p>`,
      });
      view.emailSent = mailResult.delivered;
      view.debugInviteUrl =
        mailResult.previewUrl ??
        (mailResult.delivered ? undefined : view.inviteUrl);
      if (mailResult.delivered) {
        this.logger.log(
          `Workspace invite email delivered | org=${org.name} | to=${email}`,
        );
      } else {
        this.logger.warn(
          `Workspace invite email NOT delivered | org=${org.name} | to=${email} | use copy-link fallback`,
        );
      }
    } else {
      view.debugInviteUrl = view.inviteUrl;
      view.emailSent = false;
      this.logger.log(
        `Workspace invite created without email | org=${org.name} | copy-link only`,
      );
    }

    return view;
  }

  async listInvites(payload: ListInvitesPayload): Promise<InviteView[]> {
    await this.organizationService.requireOrgAdmin({
      organizationId: payload.organizationId,
      userId: payload.requestedByUserId,
    });
    const rows = await this.tokens.find({
      where: {
        type: AuthTokenType.INVITE,
        organizationId: payload.organizationId,
      },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    const org = await this.organizations.findOne({
      where: { id: payload.organizationId },
    });
    return rows.map((row) => this.toInviteView(row, undefined, org?.name));
  }

  async getInvite(token: string): Promise<PublicInviteView> {
    const record = await this.findValidToken(token, AuthTokenType.INVITE);
    if (!record) {
      return { email: null, expiresAt: new Date(0).toISOString(), valid: false };
    }
    let organizationName: string | null = null;
    if (record.organizationId) {
      const org = await this.organizations.findOne({
        where: { id: record.organizationId },
      });
      organizationName = org?.name ?? null;
    }
    return {
      email: record.email,
      expiresAt: record.expiresAt.toISOString(),
      valid: true,
      organizationId: record.organizationId,
      organizationName,
    };
  }

  async assertInviteForRegister(
    token: string,
    email: string,
  ): Promise<AuthToken> {
    const record = await this.findValidToken(token, AuthTokenType.INVITE);
    if (!record) {
      return RpcErrors.badRequest('Invite link is invalid or expired');
    }
    if (!record.organizationId) {
      return RpcErrors.badRequest(
        'This invite is not linked to a workspace. Create a new invite from your workspace.',
      );
    }
    if (record.email && record.email !== email) {
      return RpcErrors.badRequest(
        'This invite is for a different email address',
      );
    }
    return record;
  }

  async consumeInvite(tokenId: string): Promise<void> {
    const record = await this.tokens.findOne({ where: { id: tokenId } });
    if (!record) return;
    record.usedCount += 1;
    if (record.usedCount >= record.maxUses) {
      record.revokedAt = new Date();
    }
    await this.tokens.save(record);
  }

  async revokeInvite(
    payload: RevokeInvitePayload,
  ): Promise<{ revoked: boolean }> {
    await this.organizationService.requireOrgAdmin({
      organizationId: payload.organizationId,
      userId: payload.requestedByUserId,
    });
    const record = await this.tokens.findOne({
      where: {
        id: payload.inviteId,
        type: AuthTokenType.INVITE,
        organizationId: payload.organizationId,
      },
    });
    if (!record) {
      return RpcErrors.notFound('Invite');
    }
    record.revokedAt = new Date();
    await this.tokens.save(record);
    return { revoked: true };
  }

  private async issueToken(input: {
    type: AuthTokenType;
    email: string | null;
    userId: string | null;
    createdByUserId?: string | null;
    organizationId?: string | null;
    inviteRole?: 'member' | 'guest';
    maxUses?: number;
    ttlMs: number;
  }): Promise<string> {
    if (
      input.type === AuthTokenType.EMAIL_VERIFY ||
      input.type === AuthTokenType.PASSWORD_RESET
    ) {
      await this.tokens
        .createQueryBuilder()
        .update(AuthToken)
        .set({ revokedAt: () => 'NOW()' })
        .where('type = :type', { type: input.type })
        .andWhere('userId = :userId', { userId: input.userId })
        .andWhere('revokedAt IS NULL')
        .execute();
    }

    const raw = randomBytes(32).toString('hex');
    const entity = this.tokens.create({
      type: input.type,
      tokenHash: this.hash(raw),
      email: input.email,
      userId: input.userId,
      createdByUserId: input.createdByUserId ?? null,
      organizationId: input.organizationId ?? null,
      inviteRole: input.inviteRole ?? 'member',
      maxUses: input.maxUses ?? 1,
      usedCount: 0,
      expiresAt: new Date(Date.now() + input.ttlMs),
      revokedAt: null,
    });
    await this.tokens.save(entity);
    return raw;
  }

  private async consumeToken(
    raw: string,
    type: AuthTokenType,
  ): Promise<AuthToken> {
    const record = await this.findValidToken(raw, type);
    if (!record) {
      return RpcErrors.badRequest('Token is invalid or expired');
    }
    record.usedCount += 1;
    if (record.usedCount >= record.maxUses) {
      record.revokedAt = new Date();
    }
    await this.tokens.save(record);
    return record;
  }

  private async findValidToken(
    raw: string,
    type: AuthTokenType,
  ): Promise<AuthToken | null> {
    if (!raw || raw.length < 16) {
      return null;
    }
    const match = await this.tokens.findOne({
      where: { tokenHash: this.hash(raw), type, revokedAt: IsNull() },
    });
    if (!match) return null;
    if (match.revokedAt) return null;
    if (match.expiresAt.getTime() < Date.now()) return null;
    if (match.usedCount >= match.maxUses) return null;
    return match;
  }

  private ttlMs(envKey: string, defaultHours: number): number {
    const hours = this.config.get<number>(envKey, defaultHours);
    return Math.max(1, hours) * 60 * 60 * 1000;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toInviteView(
    row: AuthToken,
    rawToken?: string,
    organizationName?: string,
  ): InviteView {
    const view: InviteView = {
      id: row.id,
      email: row.email,
      organizationId: row.organizationId,
      organizationName,
      inviteUrl: rawToken
        ? `${this.mail.publicAppUrl}/invite/${rawToken}`
        : `${this.mail.publicAppUrl}/invite`,
      maxUses: row.maxUses,
      usedCount: row.usedCount,
      expiresAt: row.expiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      createdByUserId: row.createdByUserId,
      role: row.inviteRole === 'guest' ? 'guest' : 'member',
    };
    if (rawToken) {
      view.token = rawToken;
    }
    return view;
  }
}
