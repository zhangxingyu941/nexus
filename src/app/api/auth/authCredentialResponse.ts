import { NextResponse } from "next/server";
import type { AuthCredentialErrorCode } from "../../../shared/authCredential";
import { AuthCredentialServiceUnavailableError } from "../../../server/authCredentialReplayStore";
import { AuthCredentialError } from "../../../server/authCredentialService";

const CREDENTIAL_ERRORS: Record<
  AuthCredentialErrorCode,
  { error: string; status: number }
> = {
  credential_challenge_expired: {
    error: "加密凭据已过期，请重新提交",
    status: 410,
  },
  credential_challenge_reused: {
    error: "加密凭据已使用，请重新提交",
    status: 409,
  },
  credential_invalid: {
    error: "加密凭据无效，请重新提交",
    status: 400,
  },
  credential_key_unknown: {
    error: "加密凭据密钥已更新，请重新提交",
    status: 409,
  },
  credential_required: {
    error: "请提供加密凭据",
    status: 400,
  },
  credential_service_unavailable: {
    error: "安全凭据服务未正确配置，请联系管理员",
    status: 503,
  },
  plaintext_credential_forbidden: {
    error: "认证请求不得包含明文密码或验证码",
    status: 400,
  },
};

export function authCredentialErrorResponse(error: unknown) {
  if (error instanceof AuthCredentialServiceUnavailableError) {
    return credentialErrorResponse("credential_service_unavailable");
  }
  if (error instanceof AuthCredentialError) {
    return credentialErrorResponse(error.code);
  }
  return null;
}

export function authCredentialServiceUnavailableResponse() {
  return credentialErrorResponse("credential_service_unavailable");
}

function credentialErrorResponse(code: AuthCredentialErrorCode) {
  const definition = CREDENTIAL_ERRORS[code];
  return NextResponse.json(
    { code, error: definition.error },
    { status: definition.status },
  );
}
