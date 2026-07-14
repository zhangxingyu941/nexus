import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "../../../../server/database/migrations";
import type { PasswordHasher } from "../../../../server/passwordHasher";
import { PostgresAuthStore } from "../../../../server/postgresAuthStore";
import { PostgresWorkspaceStore } from "../../../../server/postgresWorkspaceStore";
import { createSessionRouteHandlers } from "./handlers";

describe("database session route", () => {
  let pool: Pool;
  let handlers: ReturnType<typeof createSessionRouteHandlers>;
  let authStore: PostgresAuthStore;
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
    handlers = createSessionRouteHandlers(authStore, security);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("logs in with a password, creates a session cookie, and returns the current user", async () => {
    const createResponse = await handlers.POST(
      new Request("http://localhost/api/auth/session", {
        body: JSON.stringify({ email: "linxia@example.com", password: "correct horse battery staple" }),
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
        body: JSON.stringify({ email: "linxia@example.com", password: "correct horse battery staple" }),
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
    const response = await handlers.POST(
      new Request("http://localhost/api/auth/session", {
        body: JSON.stringify({ email: "linxia@example.com", password: "incorrect password" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "密码错误，请重新输入" });

    const missing = await handlers.POST(
      new Request("http://localhost/api/auth/session", {
        body: JSON.stringify({ email: "missing@example.com", password: "correct horse battery staple" }),
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

  it("returns Retry-After without attempting login when the request is limited", async () => {
    security.check.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 45, unavailable: false });
    const loginSpy = vi.spyOn(authStore, "loginWithPassword");
    const response = await handlers.POST(
      new Request("http://localhost/api/auth/session", {
        body: JSON.stringify({ email: "linxia@example.com", password: "correct horse battery staple" }),
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
  });

  it("keeps explicit login responses when audit persistence fails", async () => {
    security.audit.mockRejectedValue(new Error("audit database unavailable"));

    const invalid = await handlers.POST(
      new Request("http://localhost/api/auth/session", {
        body: JSON.stringify({ email: "linxia@example.com", password: "incorrect password" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(invalid.status).toBe(401);
    await expect(invalid.json()).resolves.toEqual({ error: "密码错误，请重新输入" });

    const valid = await handlers.POST(
      new Request("http://localhost/api/auth/session", {
        body: JSON.stringify({ email: "linxia@example.com", password: "correct horse battery staple" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
    expect(valid.status).toBe(200);
  });
});
