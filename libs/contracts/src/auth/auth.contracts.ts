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
  email?: string;
  expiresInDays?: number;
  maxUses?: number;
}

export interface InviteView {
  id: string;
  email: string | null;
  inviteUrl: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  createdByUserId: string | null;
  /** Raw token only returned when the invite is created */
  token?: string;
}

export interface GetInvitePayload {
  token: string;
}

export interface PublicInviteView {
  email: string | null;
  expiresAt: string;
  valid: boolean;
}

export interface ListInvitesPayload {
  createdByUserId?: string;
}

export interface RevokeInvitePayload {
  inviteId: string;
  requestedByUserId: string;
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
}
