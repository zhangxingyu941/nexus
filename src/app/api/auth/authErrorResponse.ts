import { NextResponse } from "next/server";
import { AuthDomainError, type AuthErrorCode } from "../../../server/authErrors";

const AUTH_ERROR_STATUS: Record<AuthErrorCode, number> = {
  auth_code_format_invalid: 400,
  display_name_required: 400,
  display_name_too_long: 400,
  email_already_registered: 409,
  email_invalid: 400,
  email_not_registered: 404,
  email_not_verified: 403,
  email_required: 400,
  email_too_long: 400,
  external_account_requires_password: 409,
  password_incorrect: 401,
  password_length_invalid: 400,
  password_not_set: 409,
  registration_password_mismatch: 409,
  reset_code_expired: 410,
  reset_code_incorrect: 400,
  reset_code_not_requested: 404,
  verify_code_expired: 410,
  verify_code_incorrect: 400,
  verify_code_not_requested: 404,
};

export function authErrorResponse(error: unknown) {
  if (!(error instanceof AuthDomainError)) {
    return null;
  }

  return NextResponse.json(
    { error: error.message },
    { status: AUTH_ERROR_STATUS[error.code] },
  );
}
