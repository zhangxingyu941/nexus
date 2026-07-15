import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCredentialError } from "../../../../server/authCredentialService";
import { createCredentialChallengeRouteHandler } from "./handlers";

const runtime = vi.hoisted(() => ({
  createPostgresServices: vi.fn(),
  getAuthCredentialService: vi.fn(),
  getAuthRequestSecurity: vi.fn(),
  hasDatabaseConfiguration: vi.fn(),
}));

vi.mock("../../../../server/applicationServices", () => ({
  createPostgresServices: runtime.createPostgresServices,
}));
vi.mock("../../../../server/authCredentialServices", () => ({
  getAuthCredentialService: runtime.getAuthCredentialService,
}));
vi.mock("../../../../server/authRequestSecurity", () => ({
  getAuthRequestSecurity: runtime.getAuthRequestSecurity,
}));
vi.mock("../../../../server/database/pool", () => ({
  hasDatabaseConfiguration: runtime.hasDatabaseConfiguration,
}));

import { POST } from "./route";

const challenge = {
  algorithm: "RSA-OAEP-256" as const,
  challenge: "signed-challenge",
  expiresAt: 1_750_000_060_000,
  key: {
    alg: "RSA-OAEP-256",
    e: "AQAB",
    kid: "auth-test",
    kty: "RSA",
    n: "public-modulus",
    use: "enc",
  },
};

describe("credential challenge handler", () => {
  const credentials = { issueChallenge: vi.fn() };
  const security = {
    audit: vi.fn(),
    check: vi.fn(),
    reset: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    credentials.issueChallenge.mockResolvedValue(challenge);
    security.check.mockResolvedValue({
      allowed: true,
      retryAfterSeconds: 1,
      unavailable: false,
    });
  });

  it("returns a challenge response with caching disabled", async () => {
    const request = jsonRequest({ purpose: "login" });
    const response = await createCredentialChallengeRouteHandler({
      credentials,
      security,
    })(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(challenge);
    expect(security.check).toHaveBeenCalledWith(
      request,
      "credential-challenge",
      "",
    );
    expect(credentials.issueChallenge).toHaveBeenCalledWith("login");
  });

  it.each([
    [{}, "missing purpose"],
    [{ purpose: "change-email" }, "unsupported purpose"],
    [{ purpose: "login", extra: true }, "extra fields"],
    [{ purpose: null }, "non-string purpose"],
  ])("rejects %s with credential_invalid", async (payload, _description) => {
    const response = await createCredentialChallengeRouteHandler({
      credentials,
      security,
    })(jsonRequest(payload));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: "credential_invalid",
      error: "加密凭据无效，请重新提交",
    });
    expect(security.check).not.toHaveBeenCalled();
    expect(credentials.issueChallenge).not.toHaveBeenCalled();
  });

  it("disables caching for JSON parse errors", async () => {
    const response = await createCredentialChallengeRouteHandler({
      credentials,
      security,
    })(new Request("http://localhost/api/auth/credential-challenge", {
      body: "{",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "请求 JSON 格式不正确",
    });
  });

  it("returns the IP rate limit decision and Retry-After", async () => {
    security.check.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 17,
      unavailable: false,
    });
    const request = jsonRequest({ purpose: "register" });

    const response = await createCredentialChallengeRouteHandler({
      credentials,
      security,
    })(request);

    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("17");
    await expect(response.json()).resolves.toEqual({
      error: "请求过于频繁，请在 17 秒后重试",
      retryAfterSeconds: 17,
    });
    expect(security.check).toHaveBeenCalledWith(
      request,
      "credential-challenge",
      "",
    );
    expect(credentials.issueChallenge).not.toHaveBeenCalled();
  });

  it("returns a stable service error without exposing credential internals", async () => {
    const internalError = "failed to decrypt private key at C:/secrets/auth.pem";
    credentials.issueChallenge.mockRejectedValue(new Error(internalError));

    const response = await createCredentialChallengeRouteHandler({
      credentials,
      security,
    })(jsonRequest({ purpose: "verify-email" }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const payload = await response.json();
    expect(payload).toEqual({
      code: "credential_service_unavailable",
      error: "安全凭据服务未正确配置，请联系管理员",
    });
    expect(JSON.stringify(payload)).not.toContain(internalError);
  });

  it("maps credential errors returned while issuing a challenge", async () => {
    credentials.issueChallenge.mockRejectedValue(
      new AuthCredentialError("credential_invalid"),
    );

    const response = await createCredentialChallengeRouteHandler({
      credentials,
      security,
    })(jsonRequest({ purpose: "reset-password" }));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      code: "credential_invalid",
      error: "加密凭据无效，请重新提交",
    });
  });
});

describe("credential challenge route setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.hasDatabaseConfiguration.mockReturnValue(true);
    runtime.createPostgresServices.mockReturnValue({ authStore: {} });
    runtime.getAuthRequestSecurity.mockReturnValue({
      audit: vi.fn(),
      check: vi.fn(),
      reset: vi.fn(),
    });
  });

  it("keeps the existing PostgreSQL-mode response when DATABASE_URL is absent", async () => {
    runtime.hasDatabaseConfiguration.mockReturnValue(false);

    const response = await POST(jsonRequest({ purpose: "login" }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "当前未启用 PostgreSQL 模式",
    });
    expect(runtime.createPostgresServices).not.toHaveBeenCalled();
    expect(runtime.getAuthCredentialService).not.toHaveBeenCalled();
  });

  it("maps credential factory configuration errors to a stable 503", async () => {
    const internalError = "Unable to read AUTH_CREDENTIAL_PRIVATE_KEY_FILE: C:/secret.pem";
    runtime.getAuthCredentialService.mockRejectedValue(new Error(internalError));

    const response = await POST(jsonRequest({ purpose: "login" }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const payload = await response.json();
    expect(payload).toEqual({
      code: "credential_service_unavailable",
      error: "安全凭据服务未正确配置，请联系管理员",
    });
    expect(JSON.stringify(payload)).not.toContain(internalError);
    expect(runtime.createPostgresServices).toHaveBeenCalledOnce();
    expect(runtime.getAuthCredentialService).toHaveBeenCalledOnce();
  });

  it("maps an asynchronously rejecting handler path to a stable 503", async () => {
    const internalError = "rate limiter connection details";
    runtime.getAuthCredentialService.mockResolvedValue({
      issueChallenge: vi.fn().mockResolvedValue(challenge),
    });
    runtime.getAuthRequestSecurity.mockReturnValue({
      audit: vi.fn(),
      check: vi.fn().mockRejectedValue(new Error(internalError)),
      reset: vi.fn(),
    });

    const response = await POST(jsonRequest({ purpose: "login" }));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const payload = await response.json();
    expect(payload).toEqual({
      code: "credential_service_unavailable",
      error: "安全凭据服务未正确配置，请联系管理员",
    });
    expect(JSON.stringify(payload)).not.toContain(internalError);
  });
});

function jsonRequest(payload: unknown) {
  return new Request("http://localhost/api/auth/credential-challenge", {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}
