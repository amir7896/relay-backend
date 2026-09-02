import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AUTH_PATTERNS } from '@app/contracts';
import type {
  ChangePasswordPayload,
  CreateInvitePayload,
  DeactivatePayload,
  ForgotPasswordPayload,
  GetInvitePayload,
  LoginPayload,
  LogoutPayload,
  RefreshPayload,
  RegisterPayload,
  RequestEmailVerificationPayload,
  ResetPasswordPayload,
  RevokeInvitePayload,
  ValidatePayload,
  VerifyEmailPayload,
} from '@app/contracts';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
  listInvites() {
    return this.authService.listInvites();
  }

  @MessagePattern(AUTH_PATTERNS.GET_INVITE)
  getInvite(@Payload() payload: GetInvitePayload) {
    return this.authService.getInvite(payload);
  }

  @MessagePattern(AUTH_PATTERNS.REVOKE_INVITE)
  revokeInvite(@Payload() payload: RevokeInvitePayload) {
    return this.authService.revokeInvite(payload);
  }
}
