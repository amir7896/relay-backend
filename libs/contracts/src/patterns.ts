export const AUTH_PATTERNS = {
  REGISTER: 'auth.register',
  LOGIN: 'auth.login',
  REFRESH: 'auth.refresh',
  LOGOUT: 'auth.logout',
  VALIDATE: 'auth.validate',
  ME: 'auth.me',
  CHANGE_PASSWORD: 'auth.change_password',
  DEACTIVATE: 'auth.deactivate',
  FORGOT_PASSWORD: 'auth.forgot_password',
  RESET_PASSWORD: 'auth.reset_password',
  REQUEST_EMAIL_VERIFICATION: 'auth.request_email_verification',
  VERIFY_EMAIL: 'auth.verify_email',
  CREATE_INVITE: 'auth.create_invite',
  LIST_INVITES: 'auth.list_invites',
  GET_INVITE: 'auth.get_invite',
  REVOKE_INVITE: 'auth.revoke_invite',
} as const;

export const USER_PATTERNS = {
  CREATE_PROFILE: 'user.create_profile',
  FIND_ALL: 'user.find_all',
  FIND_ONE: 'user.find_one',
  FIND_BY_USER_ID: 'user.find_by_user_id',
  UPDATE: 'user.update',
  REMOVE: 'user.remove',
} as const;
