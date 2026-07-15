import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCredentialServiceUnavailableError } from "../../../../../server/authCredentialReplayStore";
import { AuthCredentialError } from "../../../../../server/authCredentialService";
import { AuthDomainError } from "../../../../../server/authErrors";
import { createResetPasswordRouteHandler } from "./handlers";

const runtime = vi.hoisted(() => ({
  createPostgresServices: vi.fn(),
  getAuthCredentialDecryptor: vi.fn(),
  getAuthRequestSecurity: vi.fn(),
  hasDatabaseConfiguration: vi.fn(),
}));

vi.mock("../../../../../server/applicationServices", () => ({
  createPostgresServices: runtime.createPostgresServices,
}));
vi.mock("../../../../../server/authCredentialServices", () => ({
  getAuthCredentialDecryptor: runtime.getAuthCredentialDecryptor,
}));
vi.mock("../../../../../server/authRequestSecurity", () => ({
  getAuthRequestSecurity: runtime.getAuthRequestSecurity,
}));
vi.mock("../../../../../server/database/pool", () => ({
  hasDatabaseConfiguration: runtime.hasDatabaseConfiguration,
}));

import { POST } from "./route";

describe("reset password route", () => {
  it("resets the password and issues the replacement session cookie", async () => {
    const authStore = {
      resetPassword: vi.fn().mockResolvedValue({
        expiresAt: 5000,
        token: "replacement-session-token",
        user: { displayName: "林夏", email: "linxia@example.com", id: "user-1" },
      }),
    };
    const security = createSecurity();
    const credentials = {
      decrypt: vi.fn().mockResolvedValue({
        code: "123456",
        password: "replacement secure password",
      }),
    };
    const payload = {
      credential: "test-jwe",
      email: "linxia@example.com",
    };
    const response = await createResetPasswordRouteHandler(
      authStore,
      security,
      credentials,
    )(jsonRequest(payload));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      reset: true,
      user: { displayName: "林夏", email: "linxia@example.com", id: "user-1" },
    });
    expect(response.headers.get("set-cookie")).toContain("notion_editor_session=replacement-session-token");
    expect(credentials.decrypt).toHaveBeenCalledWith({
      credential: "test-jwe",
      email: "linxia@example.com",
      payload,
      purpose: "reset-password",
    });
    expect(authStore.resetPassword).toHaveBeenCalledWith({
      code: "123456",
      email: "linxia@example.com",
      password: "replacement secure password",
    });
    expect(security.check.mock.invocationCallOrder[0]).toBeLessThan(
      credentials.decrypt.mock.invocationCallOrder[0],
    );
    expect(credentials.decrypt.mock.invocationCallOrder[0]).toBeLessThan(
      authStore.resetPassword.mock.invocationCallOrder[0],
    );
    expect(security.reset).toHaveBeenCalledWith(
      expect.any(Request),
      "reset-password",
      "linxia@example.com",
    );
  });

  it("explains expired reset codes", async () => {
    const authStore = {
      resetPassword: vi.fn().mockRejectedValue(new AuthDomainError("reset_code_expired")),
    };
    const credentials = {
      decrypt: vi.fn().mockResolvedValue({
        code: "123456",
        password: "replacement secure password",
      }),
    };
    const response = await createResetPasswordRouteHandler(
      authStore,
      createSecurity(),
      credentials,
    )(jsonRequest({
      credential: "test-jwe",
      email: "linxia@example.com",
    }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: "密码重置验证码已过期，请重新发送" });
  });

  it("rejects top-level plaintext code and password before calling the auth store", async () => {
    const authStore = { resetPassword: vi.fn() };
    const credentials = {
      decrypt: vi.fn().mockRejectedValue(
        new AuthCredentialError("plaintext_credential_forbidden"),
      ),
    };

    const response = await createResetPasswordRouteHandler(
      authStore,
      createSecurity(),
      credentials,
    )(jsonRequest({
      code: "123456",
      email: "linxia@example.com",
      password: "replacement secure password",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "plaintext_credential_forbidden",
      error: "认证请求不得包含明文密码或验证码",
    });
    expect(authStore.resetPassword).not.toHaveBeenCalled();
  });
});

describe("reset password route setup", () => {
  const security = {
    audit: vi.fn(),
    check: vi.fn(),
    reset: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    runtime.getAuthCredentialDecryptor.mockReset();
    runtime.getAuthCredentialDecryptor.mockReturnValue({ decrypt: vi.fn() });
    security.check.mockReset();
    runtime.hasDatabaseConfiguration.mockReturnValue(true);
    runtime.createPostgresServices.mockReturnValue({ authStore: {} });
    runtime.getAuthRequestSecurity.mockReturnValue(security);
  });

  it("maps decrypt-time credential setup failures after rate limiting", async () => {
    const decrypt = vi.fn().mockRejectedValue(
      new AuthCredentialServiceUnavailableError(),
    );
    runtime.getAuthCredentialDecryptor.mockReturnValue({ decrypt });
    security.check.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 1,
      unavailable: false,
    });

    const request = jsonRequest({
      credential: "test-jwe",
      email: "linxia@example.com",
    });
    const response = await POST(request);

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload).toEqual({
      code: "credential_service_unavailable",
      error: "安全凭据服务未正确配置，请联系管理员",
    });
    expect(security.check).toHaveBeenCalledWith(
      request,
      "reset-password",
      "linxia@example.com",
    );
    expect(security.check.mock.invocationCallOrder[0]).toBeLessThan(
      decrypt.mock.invocationCallOrder[0],
    );
  });

  it("does not remap unrelated rate limiter failures", async () => {
    const unrelatedError = new Error("rate limit backend connection details");
    security.check.mockRejectedValue(unrelatedError);

    const response = POST(jsonRequest({
      credential: "test-jwe",
      email: "linxia@example.com",
    }));

    await expect(response).rejects.toBe(unrelatedError);
  });
});

function createSecurity() {
  return {
    audit: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 1, unavailable: false }),
    reset: vi.fn().mockResolvedValue(undefined),
  };
}

function jsonRequest(payload: unknown) {
  return new Request("http://localhost/api/auth/password/reset", {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}
