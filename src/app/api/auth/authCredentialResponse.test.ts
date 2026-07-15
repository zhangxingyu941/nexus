import { describe, expect, it } from "vitest";
import { AuthCredentialServiceUnavailableError } from "../../../server/authCredentialReplayStore";
import { AuthCredentialError } from "../../../server/authCredentialService";
import { authCredentialErrorResponse } from "./authCredentialResponse";

describe("authCredentialErrorResponse", () => {
  it.each([
    ["credential_required", 400, "请提供加密凭据"],
    ["plaintext_credential_forbidden", 400, "认证请求不得包含明文密码或验证码"],
    ["credential_invalid", 400, "加密凭据无效，请重新提交"],
    ["credential_key_unknown", 409, "加密凭据密钥已更新，请重新提交"],
    ["credential_challenge_expired", 410, "加密凭据已过期，请重新提交"],
    ["credential_challenge_reused", 409, "加密凭据已使用，请重新提交"],
    ["credential_service_unavailable", 503, "安全凭据服务未正确配置，请联系管理员"],
  ] as const)("maps %s to a stable %i response", async (code, status, message) => {
    const error = new AuthCredentialError(code);
    error.message = "private crypto detail";

    const response = authCredentialErrorResponse(error);
    const responseCopy = response?.clone();

    expect(response?.status).toBe(status);
    await expect(response?.json()).resolves.toEqual({ code, error: message });
    expect(JSON.stringify(await responseCopy?.json())).not.toContain("private crypto detail");
  });

  it("maps replay-store unavailability without exposing its underlying message", async () => {
    const error = new AuthCredentialServiceUnavailableError();
    error.message = "redis://user:secret@example.test";

    const response = authCredentialErrorResponse(error);

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({
      code: "credential_service_unavailable",
      error: "安全凭据服务未正确配置，请联系管理员",
    });
  });

  it("returns null for unknown errors", () => {
    expect(authCredentialErrorResponse(new Error("private key parse detail"))).toBeNull();
  });
});
