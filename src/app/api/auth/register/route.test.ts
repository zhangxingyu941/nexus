import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgMemPool } from "@/test/pgMemDatabase";
import { AuthCredentialServiceUnavailableError } from "../../../../server/authCredentialReplayStore";
import { AuthCredentialError } from "../../../../server/authCredentialService";
import { migrateDatabase } from "../../../../server/database/migrations";
import type { PasswordHasher } from "../../../../server/passwordHasher";
import { PostgresAuthStore } from "../../../../server/postgresAuthStore";
import { PostgresWorkspaceStore } from "../../../../server/postgresWorkspaceStore";
import { createRegisterRouteHandler } from "./handlers";

const runtime = vi.hoisted(() => ({
  createPostgresServices: vi.fn(),
  getAuthCredentialDecryptor: vi.fn(),
  getAuthRequestSecurity: vi.fn(),
  hasDatabaseConfiguration: vi.fn(),
  resolveAuthMailer: vi.fn(),
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
vi.mock("../authMailerResponse", () => ({
  resolveAuthMailer: runtime.resolveAuthMailer,
}));

import { POST } from "./route";

describe("registration route", () => {
  let pool: Pool;
  let authStore: PostgresAuthStore;
  let credentials: { decrypt: ReturnType<typeof vi.fn> };
  const mailer = { sendEmailVerificationCode: vi.fn().mockResolvedValue(undefined) };
  const security = {
    audit: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 1, unavailable: false }),
    reset: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    pool = createPgMemPool();
    await migrateDatabase(pool);
    const passwordHasher: PasswordHasher = {
      hash: async (password) => `hashed:${password}`,
      verify: async (hash, password) => hash === `hashed:${password}`,
    };
    authStore = new PostgresAuthStore(
      pool,
      new PostgresWorkspaceStore(pool, { idFactory: () => "workspace-register-route" }),
      {
        authCodeFactory: () => "123456",
        authCodeSecret: "route-auth-code-secret",
        now: () => 1000,
        passwordHasher,
        userIdFactory: () => "registered-user",
      },
    );
    credentials = {
      decrypt: vi.fn().mockResolvedValue({ password: "correct horse battery staple" }),
    };
  });

  afterEach(async () => {
    await pool.end();
  });

  it("registers and sends verification without exposing the code", async () => {
    const registerSpy = vi.spyOn(authStore, "register");
    const requestPayload = {
      credential: "test-jwe",
      displayName: "林夏",
      email: "linxia@example.com",
    };
    const response = await createRegisterRouteHandler({ authStore, credentials, mailer, security })(
      jsonRequest("http://localhost/api/auth/register", requestPayload),
    );

    expect(response.status).toBe(201);
    const responsePayload = await response.json();
    expect(responsePayload).toEqual({ registered: true, retryAfterSeconds: 60 });
    expect(JSON.stringify(responsePayload)).not.toContain("123456");
    expect(mailer.sendEmailVerificationCode).toHaveBeenCalledWith(
      expect.objectContaining({ email: "linxia@example.com" }),
      "123456",
    );
    expect(credentials.decrypt).toHaveBeenCalledWith({
      credential: "test-jwe",
      email: "linxia@example.com",
      payload: requestPayload,
      purpose: "register",
    });
    expect(registerSpy).toHaveBeenCalledWith({
      displayName: "林夏",
      email: "linxia@example.com",
      password: "correct horse battery staple",
    });
    expect(security.check.mock.invocationCallOrder[0]).toBeLessThan(
      credentials.decrypt.mock.invocationCallOrder[0],
    );
    expect(credentials.decrypt.mock.invocationCallOrder[0]).toBeLessThan(
      registerSpy.mock.invocationCallOrder[0],
    );

    const resend = await createRegisterRouteHandler({ authStore, credentials, mailer, security })(
      jsonRequest("http://localhost/api/auth/register", requestPayload),
    );
    expect(resend.status).toBe(429);
    expect(resend.headers.get("Retry-After")).toBe("60");
    await expect(resend.json()).resolves.toEqual({
      codeAvailable: true,
      error: "请在 60 秒后重新发送验证码",
      retryAfterSeconds: 60,
    });
    expect(mailer.sendEmailVerificationCode).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate and invalid registration with stable errors", async () => {
    credentials.decrypt
      .mockResolvedValueOnce({ password: "correct horse battery staple" })
      .mockResolvedValueOnce({ password: "different secure password" })
      .mockResolvedValueOnce({ password: "short" });
    const handler = createRegisterRouteHandler({ authStore, credentials, mailer, security });
    const valid = {
      credential: "test-jwe",
      displayName: "林夏",
      email: "linxia@example.com",
    };
    await handler(jsonRequest("http://localhost/api/auth/register", valid));

    const duplicate = await handler(jsonRequest("http://localhost/api/auth/register", {
      ...valid,
    }));
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toEqual({
      error: "该邮箱存在未完成的注册，当前密码与首次注册密码不一致；请使用首次密码或找回密码",
    });

    const invalid = await handler(jsonRequest("http://localhost/api/auth/register", {
      ...valid,
    }));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: "密码长度必须为 12 到 128 个字符" });
  });

  it("does not expose mail transport errors", async () => {
    const transportError = "connect ECONNREFUSED smtp.qq.com:465";
    const response = await createRegisterRouteHandler({
      authStore,
      credentials,
      mailer: {
        sendEmailVerificationCode: vi.fn().mockRejectedValue(new Error(transportError)),
      },
      security,
    })(jsonRequest("http://localhost/api/auth/register", {
      credential: "test-jwe",
      displayName: "林夏",
      email: "linxia@example.com",
    }));

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload).toEqual({ error: "验证邮件发送失败，请检查邮箱地址或稍后重试" });
    expect(JSON.stringify(payload)).not.toContain(transportError);
  });

  it("rejects a top-level plaintext password before calling the auth store", async () => {
    const registerSpy = vi.spyOn(authStore, "register");
    credentials.decrypt.mockRejectedValueOnce(
      new AuthCredentialError("plaintext_credential_forbidden"),
    );

    const response = await createRegisterRouteHandler({ authStore, credentials, mailer, security })(
      jsonRequest("http://localhost/api/auth/register", {
        displayName: "林夏",
        email: "linxia@example.com",
        password: "correct horse battery staple",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "plaintext_credential_forbidden",
      error: "认证请求不得包含明文密码或验证码",
    });
    expect(registerSpy).not.toHaveBeenCalled();
    expect(mailer.sendEmailVerificationCode).not.toHaveBeenCalled();
  });
});

describe("registration route setup", () => {
  const mailer = { sendEmailVerificationCode: vi.fn() };
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
    runtime.resolveAuthMailer.mockReturnValue({ mailer, ok: true });
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

    const request = jsonRequest("http://localhost/api/auth/register", {
      credential: "test-jwe",
      displayName: "林夏",
      email: "linxia@example.com",
    });
    const response = await POST(request);

    expect(response.status).toBe(503);
    const payload = await response.json();
    expect(payload).toEqual({
      code: "credential_service_unavailable",
      error: "安全凭据服务未正确配置，请联系管理员",
    });
    expect(security.check).toHaveBeenCalledWith(request, "register", "linxia@example.com");
    expect(security.check.mock.invocationCallOrder[0]).toBeLessThan(
      decrypt.mock.invocationCallOrder[0],
    );
    expect(runtime.getAuthCredentialDecryptor).toHaveBeenCalledOnce();
  });

  it("does not remap unrelated rate limiter failures", async () => {
    const unrelatedError = new Error("rate limit backend connection details");
    security.check.mockRejectedValue(unrelatedError);

    const response = POST(jsonRequest("http://localhost/api/auth/register", {
      credential: "test-jwe",
      displayName: "林夏",
      email: "linxia@example.com",
    }));

    await expect(response).rejects.toBe(unrelatedError);
  });
});

function jsonRequest(url: string, payload: unknown) {
  return new Request(url, {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}
