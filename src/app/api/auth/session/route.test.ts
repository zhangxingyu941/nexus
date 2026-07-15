import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCredentialServiceUnavailableError } from "../../../../server/authCredentialReplayStore";
import { AuthCredentialError } from "../../../../server/authCredentialService";
import { migrateDatabase } from "../../../../server/database/migrations";
import type { PasswordHasher } from "../../../../server/passwordHasher";
import { PostgresAuthStore } from "../../../../server/postgresAuthStore";
import { PostgresWorkspaceStore } from "../../../../server/postgresWorkspaceStore";
import { createSessionRouteHandlers } from "./handlers";

const runtime = vi.hoisted(() => ({
  createPostgresServices: vi.fn(),
  getAuthCredentialDecryptor: vi.fn(),
  getAuthRequestSecurity: vi.fn(),
  hasDatabaseConfiguration: vi.fn(),
}));

vi.mock("../../../../server/applicationServices", () => ({
  createPostgresServices: runtime.createPostgresServices,
}));
vi.mock("../../../../server/authCredentialServices", () => ({
  getAuthCredentialDecryptor: runtime.getAuthCredentialDecryptor,
}));
vi.mock("../../../../server/authRequestSecurity", () => ({
  getAuthRequestSecurity: runtime.getAuthRequestSecurity,
}));
vi.mock("../../../../server/database/pool", () => ({
  hasDatabaseConfiguration: runtime.hasDatabaseConfiguration,
}));

import { DELETE, GET, POST } from "./route";

describe("database session route", () => {
  let pool: Pool;
  let handlers: ReturnType<typeof createSessionRouteHandlers>;
  let authStore: PostgresAuthStore;
  let credentials: { decrypt: ReturnType<typeof vi.fn> };
  let security: {
    audit: ReturnType<typeof vi.fn>;
    check: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const memoryDatabase = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = memoryDatabase.adapters.createPg();
    pool = new adapter.Pool() as Pool;
    await migrateDatabase(pool);
    const workspaceStore = new PostgresWorkspaceStore(pool, { idFactory: () => "workspace-session-route" });
    const passwordHasher: PasswordHasher = {
      hash: async (password) => `hashed:${password}`,
      verify: async (hash, password) => hash === `hashed:${password}`,
    };
    authStore = new PostgresAuthStore(pool, workspaceStore, {
      authCodeFactory: () => "123456",
      authCodeSecret: "route-auth-code-secret",
      now: () => 1000,
      passwordHasher,
      sessionTokenFactory: () => "route-session-token",
      userIdFactory: () => "route-user",
    });
    await authStore.register({
      displayName: "林夏",
      email: "linxia@example.com",
      password: "correct horse battery staple",
    });
    await authStore.verifyEmail({ code: "123456", email: "linxia@example.com" });
    security = {
      audit: vi.fn().mockResolvedValue(undefined),
      check: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 1, unavailable: false }),
      reset: vi.fn().mockResolvedValue(undefined),
    };
    credentials = {
      decrypt: vi.fn().mockResolvedValue({ password: "correct horse battery staple" }),
    };
    handlers = createSessionRouteHandlers(authStore, security, credentials);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("logs in with a password, creates a session cookie, and returns the current user", async () => {
    const loginSpy = vi.spyOn(authStore, "loginWithPassword");
    const payload = { email: "linxia@example.com", credential: "test-jwe" };
    const createResponse = await handlers.POST(
      new Request("http://localhost/api/auth/session", {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const cookie = createResponse.headers.get("set-cookie");

    expect(createResponse.status).toBe(200);
    await expect(createResponse.json()).resolves.toEqual({
      mode: "database",
      user: { displayName: "林夏", email: "linxia@example.com", id: "route-user" },
    });
    expect(cookie).toContain("notion_editor_session=route-session-token");
    expect(cookie).toContain("HttpOnly");
    expect(credentials.decrypt).toHaveBeenCalledWith({
      credential: "test-jwe",
      email: "linxia@example.com",
      payload,
      purpose: "login",
    });
    expect(loginSpy).toHaveBeenCalledWith({
      email: "linxia@example.com",
      password: "correct horse battery staple",
    });
    expect(security.check.mock.invocationCallOrder[0]).toBeLessThan(
      credentials.decrypt.mock.invocationCallOrder[0],
    );
    expect(credentials.decrypt.mock.invocationCallOrder[0]).toBeLessThan(
      loginSpy.mock.invocationCallOrder[0],
    );
    expect(security.reset).toHaveBeenCalledWith(
      expect.any(Request),
      "login",
      "linxia@example.com",
    );

    const sessionResponse = await handlers.GET(
      new Request("http://localhost/api/auth/session", { headers: { Cookie: cookie ?? "" } }),
    );
    expect(sessionResponse.status).toBe(200);
    await expect(sessionResponse.json()).resolves.toEqual({
      mode: "database",
      user: { displayName: "林夏", email: "linxia@example.com", id: "route-user" },
    });
  });

  it("returns 401 without a valid session and clears revoked sessions", async () => {
    const unauthorized = await handlers.GET(new Request("http://localhost/api/auth/session"));
    expect(unauthorized.status).toBe(401);

    await handlers.POST(
      new Request("http://localhost/api/auth/session", {
        body: JSON.stringify({ email: "linxia@example.com", credential: "test-jwe" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    const deleteResponse = await handlers.DELETE(
      new Request("http://localhost/api/auth/session", {
        headers: { Cookie: "notion_editor_session=route-session-token" },
        method: "DELETE",
      }),
    );

    expect(deleteResponse.status).toBe(204);
    expect(deleteResponse.headers.get("set-cookie")).toContain("notion_editor_session=");
    const revoked = await handlers.GET(
      new Request("http://localhost/api/auth/session", {
        headers: { Cookie: "notion_editor_session=route-session-token" },
      }),
    );
    expect(revoked.status).toBe(401);
  });

  it("explains invalid credentials and missing accounts", async () => {
    credentials.decrypt
      .mockResolvedValueOnce({ password: "incorrect password" })
      .mockResolvedValueOnce({ password: "correct horse battery staple" });
    const response = await handlers.POST(
      new Request("http://localhost/api/auth/session", {
        body: JSON.stringify({ email: "linxia@example.com", credential: "test-jwe" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "密码错误，请重新输入" });

    const missing = await handlers.POST(
      new Request("http://localhost/api/auth/session", {
        body: JSON.stringify({ email: "missing@example.com", credential: "test-jwe" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toEqual({ error: "该邮箱尚未注册，请先创建账号" });
  });

  it("rejects non-JSON login requests", async () => {
    const response = await handlers.POST(
      new Request("http://localhost/api/auth/session", {
        body: "email=linxia@example.com",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(415);
  });

  it("rejects a top-level plaintext password before calling the auth store", async () => {
    const loginSpy = vi.spyOn(authStore, "loginWithPassword");
    credentials.decrypt.mockRejectedValueOnce(
      new AuthCredentialError("plaintext_credential_forbidden"),
    );
    const payload = {
      email: "linxia@example.com",
      password: "correct horse battery staple",
    };

    const response = await handlers.POST(
      new Request("http://localhost/api/auth/session", {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "plaintext_credential_forbidden",
      error: "认证请求不得包含明文密码或验证码",
    });
    expect(credentials.decrypt).toHaveBeenCalledWith({
      credential: undefined,
      email: "linxia@example.com",
      payload,
      purpose: "login",
    });
    expect(loginSpy).not.toHaveBeenCalled();
  });

  it("returns Retry-After without attempting login when the request is limited", async () => {
    security.check.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 45, unavailable: false });
    const loginSpy = vi.spyOn(authStore, "loginWithPassword");
    const response = await handlers.POST(
      new Request("http://localhost/api/auth/session", {
        body: JSON.stringify({ email: "linxia@example.com", credential: "test-jwe" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("45");
    await expect(response.json()).resolves.toEqual({
      error: "请求过于频繁，请在 45 秒后重试",
      retryAfterSeconds: 45,
    });
    expect(loginSpy).not.toHaveBeenCalled();
    expect(credentials.decrypt).not.toHaveBeenCalled();
  });

  it("keeps explicit login responses when audit persistence fails", async () => {
    security.audit.mockRejectedValue(new Error("audit database unavailable"));
    credentials.decrypt
      .mockResolvedValueOnce({ password: "incorrect password" })
      .mockResolvedValueOnce({ password: "correct horse battery staple" });

    const invalid = await handlers.POST(
      new Request("http://localhost/api/auth/session", {
        body: JSON.stringify({ email: "linxia@example.com", credential: "test-jwe" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(invalid.status).toBe(401);
    await expect(invalid.json()).resolves.toEqual({ error: "密码错误，请重新输入" });

    const valid = await handlers.POST(
      new Request("http://localhost/api/auth/session", {
        body: JSON.stringify({ email: "linxia@example.com", credential: "test-jwe" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(valid.status).toBe(200);
  });
});

describe("session route setup", () => {
  const authStore = {
    deleteSession: vi.fn().mockResolvedValue(undefined),
    getUserBySessionToken: vi.fn().mockResolvedValue(null),
    loginWithPassword: vi.fn(),
  };
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
    runtime.createPostgresServices.mockReturnValue({ authStore });
    runtime.getAuthRequestSecurity.mockReturnValue(security);
  });

  it("does not initialize credentials for GET or DELETE", async () => {
    const getResponse = await GET(new Request("http://localhost/api/auth/session"));
    const deleteResponse = await DELETE(new Request("http://localhost/api/auth/session", {
      method: "DELETE",
    }));

    expect(getResponse.status).toBe(401);
    expect(deleteResponse.status).toBe(204);
    expect(runtime.getAuthCredentialDecryptor).not.toHaveBeenCalled();
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

    const request = new Request("http://localhost/api/auth/session", {
      body: JSON.stringify({ email: "linxia@example.com", credential: "test-jwe" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const response = await POST(request);

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload).toEqual({
      code: "credential_service_unavailable",
      error: "安全凭据服务未正确配置，请联系管理员",
    });
    expect(security.check).toHaveBeenCalledWith(request, "login", "linxia@example.com");
    expect(security.check.mock.invocationCallOrder[0]).toBeLessThan(
      decrypt.mock.invocationCallOrder[0],
    );
    expect(runtime.getAuthCredentialDecryptor).toHaveBeenCalledOnce();
  });

  it("does not remap unrelated rate limiter failures", async () => {
    const unrelatedError = new Error("rate limit backend connection details");
    security.check.mockRejectedValue(unrelatedError);

    const response = POST(new Request("http://localhost/api/auth/session", {
      body: JSON.stringify({ email: "linxia@example.com", credential: "test-jwe" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }));

    await expect(response).rejects.toBe(unrelatedError);
  });
});
