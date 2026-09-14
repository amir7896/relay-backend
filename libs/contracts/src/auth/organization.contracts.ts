export type OrgMemberRole = 'owner' | 'admin' | 'member';

export interface OrganizationView {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  isDefault: boolean;
  role?: OrgMemberRole;
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
  role: 'admin' | 'member';
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

export interface TransferOwnershipPayload {
  organizationId: string;
  actorId: string;
  newOwnerUserId: string;
}
