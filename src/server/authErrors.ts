export type AuthErrorCode =
  | "display_name_required"
  | "display_name_too_long"
  | "email_required"
  | "email_too_long"
  | "email_invalid"
  | "password_length_invalid"
  | "email_already_registered"
  | "registration_password_mismatch"
  | "external_account_requires_password"
  | "email_not_registered"
  | "email_not_verified"
  | "password_not_set"
  | "password_incorrect"
  | "auth_code_format_invalid"
  | "verify_code_not_requested"
  | "verify_code_expired"
  | "verify_code_incorrect"
  | "reset_code_not_requested"
  | "reset_code_expired"
  | "reset_code_incorrect";

const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  auth_code_format_invalid: "验证码必须是 6 位数字",
  display_name_required: "请输入姓名",
  display_name_too_long: "姓名不能超过 80 个字符",
  email_already_registered: "该邮箱已注册，请直接登录或使用找回密码",
  email_invalid: "请输入有效的邮箱地址",
  email_not_registered: "该邮箱尚未注册，请先创建账号",
  email_not_verified: "邮箱尚未验证，请先输入邮件中的验证码",
  email_required: "请输入邮箱",
  email_too_long: "邮箱不能超过 254 个字符",
  external_account_requires_password: "该邮箱已通过其他登录方式注册，请使用对应登录方式，或通过找回密码设置密码",
  password_incorrect: "密码错误，请重新输入",
  password_length_invalid: "密码长度必须为 12 到 128 个字符",
  password_not_set: "该账号尚未设置密码，请使用找回密码设置密码",
  registration_password_mismatch: "该邮箱存在未完成的注册，当前密码与首次注册密码不一致；请使用首次密码或找回密码",
  reset_code_expired: "密码重置验证码已过期，请重新发送",
  reset_code_incorrect: "密码重置验证码错误，请重新输入",
  reset_code_not_requested: "尚未发送密码重置验证码，请先重新发送",
  verify_code_expired: "邮箱验证码已过期，请重新发送",
  verify_code_incorrect: "邮箱验证码错误，请重新输入",
  verify_code_not_requested: "尚未发送邮箱验证码，请先重新发送",
};

export class AuthDomainError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(AUTH_ERROR_MESSAGES[code]);
    this.name = "AuthDomainError";
  }
}

export function createAuthDomainError(code: AuthErrorCode) {
  return new AuthDomainError(code);
}
