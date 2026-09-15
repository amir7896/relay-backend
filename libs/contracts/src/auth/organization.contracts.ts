export type OrgMemberRole = 'owner' | 'admin' | 'member' | 'guest';

export interface OrganizationView {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  isDefault: boolean;
  role?: OrgMemberRole;
  plan: 'free' | 'pro' | 'enterprise';
  maxSeats: number;
  seatCount?: number;
  ssoEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Injected by API gateway into user/chat RPC payloads. */
export interface TenantContextPayload {
  organizationId: string;
}

export interface CreateOrganizationPayload {
  userId: string;
  name: string;
  slug?: string;
}

export interface ListOrganizationsPayload {
  userId: string;
}

export interface GetOrganizationPayload {
  userId: string;
  organizationId: string;
}

export interface EnsureDefaultOrganizationPayload {
  /** Optional label only — shared DBs are used for all orgs. */
  name?: string;
}

export interface AddOrgMemberPayload {
  organizationId: string;
  userId: string;
  role?: OrgMemberRole;
  actorId: string;
}

export interface ResolveTenantPayload {
  userId: string;
  organizationId: string;
}

export interface DeleteOrganizationPayload {
  userId: string;
  organizationId: string;
  /** Must match the workspace name exactly (trimmed). */
  confirmName: string;
}

export interface DeleteOrganizationResult {
  deletedOrganizationId: string;
  remainingOrganizations: OrganizationView[];
}

export interface LeaveOrganizationPayload {
  userId: string;
  organizationId: string;
}

export interface LeaveOrganizationResult {
  leftOrganizationId: string;
  remainingOrganizations: OrganizationView[];
}

export interface AcceptInvitePayload {
  userId: string;
  email: string;
  inviteToken: string;
}

export interface AcceptInviteResult {
  organizationId: string;
  organizations: OrganizationView[];
  activeOrganizationId: string;
  alreadyMember: boolean;
  /** Membership role granted by the invite (guests skip #general). */
  role: OrgMemberRole;
}

export interface OrgMemberView {
  userId: string;
  role: OrgMemberRole;
  joinedAt: string;
}

export interface ListOrgMembersPayload {
  organizationId: string;
  requestedByUserId: string;
}

export interface SetOrgMemberRolePayload {
  organizationId: string;
  actorId: string;
  memberId: string;
  role: 'admin' | 'member' | 'guest';
}

export interface RemoveOrgMemberPayload {
  organizationId: string;
  actorId: string;
  memberId: string;
}

export interface UpdateOrganizationPayload {
  organizationId: string;
  actorId: string;
  name: string;
}

export interface UpdateOrgBillingPayload {
  organizationId: string;
  actorId: string;
  plan?: 'free' | 'pro' | 'enterprise';
  maxSeats?: number;
}

export interface CreateBillingCheckoutPayload {
  organizationId: string;
  actorId: string;
  plan: 'pro' | 'enterprise';
  successUrl: string;
  cancelUrl: string;
}

export interface BillingCheckoutResult {
  url: string;
}

export interface CreateBillingPortalPayload {
  organizationId: string;
  actorId: string;
  returnUrl: string;
}

export interface BillingPortalResult {
  url: string;
}

export interface ApplyStripeSubscriptionPayload {
  customerId: string;
  subscriptionId: string | null;
  priceId: string | null;
  status: string;
}

export interface HandleStripeWebhookPayload {
  /** Raw body string for signature verification when secret is set */
  rawBody?: string;
  signature?: string;
  /** Unsigned / parsed event for local testing without webhook secret */
  type?: string;
  data?: Record<string, unknown>;
}

export interface UpdateOrgSsoPayload {
  organizationId: string;
  actorId: string;
  ssoEnabled: boolean;
  ssoProvider?: 'oidc' | 'saml' | null;
  ssoIssuerUrl?: string | null;
  ssoClientId?: string | null;
  /** Write-only; omit to keep existing secret. */
  ssoClientSecret?: string | null;
}

export interface OrgSsoView {
  organizationId: string;
  ssoEnabled: boolean;
  ssoProvider: 'oidc' | 'saml' | null;
  ssoIssuerUrl: string | null;
  ssoClientId: string | null;
  hasClientSecret: boolean;
  /** Workspace billing plan — SSO login requires pro or enterprise. */
  plan: 'free' | 'pro' | 'enterprise';
  /** True when OIDC login can start (paid plan + enabled + issuer + client id + secret). */
  configured: boolean;
}

/** Gateway-only: includes client secret for token exchange. */
export interface OrgSsoCredentialsView extends OrgSsoView {
  ssoClientSecret: string | null;
  slug: string;
  name: string;
}

export interface SsoCompletePayload {
  organizationId: string;
  email: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
  ip?: string;
  userAgent?: string;
}

export interface TransferOwnershipPayload {
  organizationId: string;
  actorId: string;
  newOwnerUserId: string;
}
