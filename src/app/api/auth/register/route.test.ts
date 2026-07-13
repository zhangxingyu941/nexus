import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "../../../../server/database/migrations";
import type { PasswordHasher } from "../../../../server/passwordHasher";
import { PostgresAuthStore } from "../../../../server/postgresAuthStore";
import { PostgresWorkspaceStore } from "../../../../server/postgresWorkspaceStore";
import { createRegisterRouteHandler } from "./handlers";

describe("registration route", () => {
  let pool: Pool;
  let authStore: PostgresAuthStore;
  const mailer = { sendEmailVerificationCode: vi.fn().mockResolvedValue(undefined) };
  const security = {
    audit: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 1, unavailable: false }),
    reset: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const memoryDatabase = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = memoryDatabase.adapters.createPg();
    pool = new adapter.Pool() as Pool;
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
  });

  afterEach(async () => {
    await pool.end();
  });

  it("registers and sends verification without exposing the code", async () => {
    const response = await createRegisterRouteHandler({ authStore, mailer, security })(
      jsonRequest("http://localhost/api/auth/register", {
        displayName: "林夏",
        email: "linxia@example.com",
        password: "correct horse battery staple",
      }),
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload).toEqual({ registered: true, retryAfterSeconds: 60 });
    expect(JSON.stringify(payload)).not.toContain("123456");
    expect(mailer.sendEmailVerificationCode).toHaveBeenCalledWith(
      expect.objectContaining({ email: "linxia@example.com" }),
      "123456",
    );

    const resend = await createRegisterRouteHandler({ authStore, mailer, security })(
      jsonRequest("http://localhost/api/auth/register", {
        displayName: "林夏",
        email: "linxia@example.com",
        password: "correct horse battery staple",
      }),
    );
    expect(resend.status).toBe(429);
    expect(resend.headers.get("Retry-After")).toBe("60");
    await expect(resend.json()).resolves.toEqual({
      error: "请在 60 秒后重新发送验证码",
      retryAfterSeconds: 60,
    });
    expect(mailer.sendEmailVerificationCode).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate and invalid registration with stable errors", async () => {
    const handler = createRegisterRouteHandler({ authStore, mailer, security });
    const valid = {
      displayName: "林夏",
      email: "linxia@example.com",
      password: "correct horse battery staple",
    };
    await handler(jsonRequest("http://localhost/api/auth/register", valid));

    const duplicate = await handler(jsonRequest("http://localhost/api/auth/register", {
      ...valid,
      password: "different secure password",
    }));
    expect(duplicate.status).toBe(400);
    await expect(duplicate.json()).resolves.toEqual({ error: "无法创建账号" });

    const invalid = await handler(jsonRequest("http://localhost/api/auth/register", {
      ...valid,
      password: "short",
    }));
    expect(invalid.status).toBe(400);
  });
});

function jsonRequest(url: string, payload: unknown) {
  return new Request(url, {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}
