import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AUTH_PATTERNS } from '@app/contracts';
import type {
  AcceptInvitePayload,
  AddOrgMemberPayload,
  ChangePasswordPayload,
  CreateInvitePayload,
  CreateOrganizationPayload,
  DeactivatePayload,
  DeleteOrganizationPayload,
  EnsureDefaultOrganizationPayload,
  ForgotPasswordPayload,
  GetInvitePayload,
  GetOrganizationPayload,
  LeaveOrganizationPayload,
  ListOrganizationsPayload,
  ListOrgMembersPayload,
  ListInvitesPayload,
  LoginPayload,
  LogoutPayload,
  RefreshPayload,
  RegisterPayload,
  RemoveOrgMemberPayload,
  RequestEmailVerificationPayload,
  ResetPasswordPayload,
  ResolveTenantPayload,
  RevokeInvitePayload,
  SetOrgMemberRolePayload,
  TransferOwnershipPayload,
  UpdateOrganizationPayload,
  ValidatePayload,
  VerifyEmailPayload,
} from '@app/contracts';
import { AuthService } from './auth.service';
import { OrganizationService } from './organization.service';

@Controller()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly organizationService: OrganizationService,
  ) {}

  @MessagePattern(AUTH_PATTERNS.REGISTER)
  register(@Payload() payload: RegisterPayload) {
    return this.authService.register(payload);
  }

  @MessagePattern(AUTH_PATTERNS.LOGIN)
  login(@Payload() payload: LoginPayload) {
    return this.authService.login(payload);
  }

  @MessagePattern(AUTH_PATTERNS.REFRESH)
  refresh(@Payload() payload: RefreshPayload) {
    return this.authService.refresh(payload);
  }

  @MessagePattern(AUTH_PATTERNS.LOGOUT)
  logout(@Payload() payload: LogoutPayload) {
    return this.authService.logout(payload);
  }

  @MessagePattern(AUTH_PATTERNS.VALIDATE)
  validate(@Payload() payload: ValidatePayload) {
    return this.authService.validate(payload);
  }

  @MessagePattern(AUTH_PATTERNS.ME)
  me(@Payload() payload: { userId: string }) {
    return this.authService.me(payload.userId);
  }

  @MessagePattern(AUTH_PATTERNS.CHANGE_PASSWORD)
  changePassword(@Payload() payload: ChangePasswordPayload) {
    return this.authService.changePassword(payload);
  }

  @MessagePattern(AUTH_PATTERNS.DEACTIVATE)
  deactivate(@Payload() payload: DeactivatePayload) {
    return this.authService.deactivate(payload);
  }

  @MessagePattern(AUTH_PATTERNS.FORGOT_PASSWORD)
  forgotPassword(@Payload() payload: ForgotPasswordPayload) {
    return this.authService.forgotPassword(payload);
  }

  @MessagePattern(AUTH_PATTERNS.RESET_PASSWORD)
  resetPassword(@Payload() payload: ResetPasswordPayload) {
    return this.authService.resetPassword(payload);
  }

  @MessagePattern(AUTH_PATTERNS.REQUEST_EMAIL_VERIFICATION)
  requestEmailVerification(
    @Payload() payload: RequestEmailVerificationPayload,
  ) {
    return this.authService.requestEmailVerification(payload);
  }

  @MessagePattern(AUTH_PATTERNS.VERIFY_EMAIL)
  verifyEmail(@Payload() payload: VerifyEmailPayload) {
    return this.authService.verifyEmail(payload);
  }

  @MessagePattern(AUTH_PATTERNS.CREATE_INVITE)
  createInvite(@Payload() payload: CreateInvitePayload) {
    return this.authService.createInvite(payload);
  }

  @MessagePattern(AUTH_PATTERNS.LIST_INVITES)
  listInvites(@Payload() payload: ListInvitesPayload) {
    return this.authService.listInvites(payload);
  }

  @MessagePattern(AUTH_PATTERNS.GET_INVITE)
  getInvite(@Payload() payload: GetInvitePayload) {
    return this.authService.getInvite(payload);
  }

  @MessagePattern(AUTH_PATTERNS.REVOKE_INVITE)
  revokeInvite(@Payload() payload: RevokeInvitePayload) {
    return this.authService.revokeInvite(payload);
  }

  @MessagePattern(AUTH_PATTERNS.CREATE_ORGANIZATION)
  createOrganization(@Payload() payload: CreateOrganizationPayload) {
    return this.organizationService.createOrganization(payload);
  }

  @MessagePattern(AUTH_PATTERNS.LIST_ORGANIZATIONS)
  listOrganizations(@Payload() payload: ListOrganizationsPayload) {
    return this.organizationService.listForUser(payload);
  }

  @MessagePattern(AUTH_PATTERNS.GET_ORGANIZATION)
  getOrganization(@Payload() payload: GetOrganizationPayload) {
    return this.organizationService.getForUser(payload);
  }

  @MessagePattern(AUTH_PATTERNS.DELETE_ORGANIZATION)
  deleteOrganization(@Payload() payload: DeleteOrganizationPayload) {
    return this.organizationService.deleteOrganization(payload);
  }

  @MessagePattern(AUTH_PATTERNS.LEAVE_ORGANIZATION)
  leaveOrganization(@Payload() payload: LeaveOrganizationPayload) {
    return this.organizationService.leaveOrganization(payload);
  }

  @MessagePattern(AUTH_PATTERNS.ACCEPT_INVITE)
  acceptInvite(@Payload() payload: AcceptInvitePayload) {
    return this.authService.acceptInvite(payload);
  }

  @MessagePattern(AUTH_PATTERNS.LIST_ORG_MEMBERS)
  listOrgMembers(@Payload() payload: ListOrgMembersPayload) {
    return this.organizationService.listMembers(payload);
  }

  @MessagePattern(AUTH_PATTERNS.SET_ORG_MEMBER_ROLE)
  setOrgMemberRole(@Payload() payload: SetOrgMemberRolePayload) {
    return this.organizationService.setMemberRole(payload);
  }

  @MessagePattern(AUTH_PATTERNS.REMOVE_ORG_MEMBER)
  removeOrgMember(@Payload() payload: RemoveOrgMemberPayload) {
    return this.organizationService.removeMember(payload);
  }

  @MessagePattern(AUTH_PATTERNS.UPDATE_ORGANIZATION)
  updateOrganization(@Payload() payload: UpdateOrganizationPayload) {
    return this.organizationService.updateOrganization(payload);
  }

  @MessagePattern(AUTH_PATTERNS.TRANSFER_OWNERSHIP)
  transferOwnership(@Payload() payload: TransferOwnershipPayload) {
    return this.organizationService.transferOwnership(payload);
  }

  @MessagePattern(AUTH_PATTERNS.RESOLVE_TENANT)
  resolveTenant(@Payload() payload: ResolveTenantPayload) {
    return this.organizationService.resolveTenant(payload);
  }

  @MessagePattern(AUTH_PATTERNS.ENSURE_DEFAULT_ORGANIZATION)
  ensureDefaultOrganization(
    @Payload() payload: EnsureDefaultOrganizationPayload,
  ) {
    return this.organizationService.ensureDefaultOrganization(payload);
  }

  @MessagePattern(AUTH_PATTERNS.ADD_ORG_MEMBER)
  addOrgMember(@Payload() payload: AddOrgMemberPayload) {
    return this.organizationService.addMember(payload);
  }
}
