import { UserRole } from '@app/common';

export interface RegisterPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  inviteToken?: string;
}

export interface ForgotPasswordPayload {
  email: string;
}

export interface ForgotPasswordResult {
  accepted: boolean;
  /** Present in development when SMTP is not configured */
  debugResetUrl?: string;
}

export interface ResetPasswordPayload {
  token: string;
  password: string;
}

export interface RequestEmailVerificationPayload {
  userId: string;
}

export interface RequestEmailVerificationResult {
  sent: boolean;
  debugVerifyUrl?: string;
}

export interface VerifyEmailPayload {
  token: string;
}

export interface CreateInvitePayload {
  createdByUserId: string;
  organizationId: string;
  email?: string;
  expiresInDays?: number;
  maxUses?: number;
  /** Full member (default) or guest with limited channel access. */
  role?: 'member' | 'guest';
  /** When true, create the invite token but do not send the default email. */
  skipEmail?: boolean;
  /**
   * Channel to auto-join after workspace invite accept (Slack-style channel invite
   * for people who are not yet in the workspace).
   */
  pendingChannelId?: string | null;
}

export interface InviteView {
  id: string;
  email: string | null;
  organizationId: string | null;
  organizationName?: string;
  inviteUrl: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  createdByUserId: string | null;
  role?: 'member' | 'guest';
  /** Raw token only returned when the invite is created */
  token?: string;
  /** Present when SMTP is off or for local testing (copy/paste) */
  debugInviteUrl?: string;
  emailSent?: boolean;
}

export interface GetInvitePayload {
  token: string;
}

export interface PublicInviteView {
  email: string | null;
  expiresAt: string;
  valid: boolean;
  organizationId?: string | null;
  organizationName?: string | null;
  /** Present when this invite also grants a specific channel after accept. */
  pendingChannelId?: string | null;
}

export interface ListInvitesPayload {
  organizationId: string;
  requestedByUserId: string;
  page?: number;
  limit?: number;
}

export interface RevokeInvitePayload {
  inviteId: string;
  requestedByUserId: string;
  organizationId: string;
}

export interface LoginPayload {
  email: string;
  password: string;
  ip?: string;
  userAgent?: string;
}

export interface RefreshPayload {
  refreshToken: string;
  ip?: string;
  userAgent?: string;
}

export interface LogoutPayload {
  userId: string;
  refreshToken?: string;
  accessToken?: string;
}

export interface ValidatePayload {
  userId: string;
}

export interface DeactivatePayload {
  userId: string;
}

export interface ChangePasswordPayload {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

export interface AuthUserView {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  isEmailVerified: boolean;
  totpEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
}

export interface AuthResult {
  user: AuthUserView;
  tokens: TokenPair;
  organizations: import('./organization.contracts').OrganizationView[];
  /** Suggested active org (first membership / default). */
  activeOrganizationId: string | null;
  /** Set when registration completed a workspace invite tied to a channel. */
  pendingChannelId?: string | null;
}

/** Returned when password is correct but TOTP is required */
export interface AuthResultRequires2fa {
  requires2fa: true;
  tempToken: string;
  userId: string;
  email: string;
}

export type LoginResult = AuthResult | AuthResultRequires2fa;

export interface Verify2faLoginPayload {
  tempToken: string;
  code: string;
  ip?: string;
  userAgent?: string;
}

export interface Setup2faPayload {
  userId: string;
}

export interface Setup2faResult {
  secret: string;
  otpauthUrl: string;
}

export interface Confirm2faPayload {
  userId: string;
  code: string;
}

export interface Disable2faPayload {
  userId: string;
  password: string;
  code?: string;
}

export interface SessionView {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export interface ListSessionsPayload {
  userId: string;
  currentRefreshToken?: string;
}

export interface RevokeSessionPayload {
  userId: string;
  sessionId: string;
}

export interface RevokeOtherSessionsPayload {
  userId: string;
  currentRefreshToken?: string;
}
