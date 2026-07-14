import { newDb } from "pg-mem";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "./database/migrations";
import { hashAuthCode } from "./authTokens";
import type { PasswordHasher } from "./passwordHasher";
import { PostgresAuthStore } from "./postgresAuthStore";
import { PostgresWorkspaceStore } from "./postgresWorkspaceStore";

describe("PostgresAuthStore", () => {
  let pool: Pool;
  let authStore: PostgresAuthStore;
  let now: number;
  let passwordHasher: PasswordHasher;

  beforeEach(async () => {
    now = 1000;
    let authCodeSequence = 0;
    const authCodes = ["123456", "654321", "222222", "333333"];
    let sessionTokenSequence = 0;
    const memoryDatabase = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = memoryDatabase.adapters.createPg();
    pool = new adapter.Pool() as Pool;
    await migrateDatabase(pool);
    const workspaceStore = new PostgresWorkspaceStore(pool, {
      idFactory: () => "workspace-auth-test",
      now: () => 2000,
    });
    passwordHasher = {
      hash: vi.fn(async (password: string) => `hashed:${password}`),
      verify: vi.fn(async (hash: string, password: string) => hash === `hashed:${password}`),
    };
    authStore = new PostgresAuthStore(pool, workspaceStore, {
      authCodeFactory: () => authCodes[authCodeSequence++] ?? "999999",
      authCodeSecret: "test-auth-code-secret",
      now: () => now,
      passwordHasher,
      sessionTokenFactory: () => sessionTokenSequence++ === 0
        ? "plain-session-token"
        : "replacement-session-token",
      userIdFactory: () => "user-auth-test",
    });
  });

  afterEach(async () => {
    await pool.end();
  });

  it("creates a normalized user, personal workspace, and hashed session", async () => {
    const session = await authStore.createSession({
      displayName: " 林夏 ",
      email: "LINXIA@Example.com ",
    });

    expect(session).toEqual({
      expiresAt: 1000 + 30 * 24 * 60 * 60 * 1000,
      token: "plain-session-token",
      user: {
        displayName: "林夏",
        email: "linxia@example.com",
        id: "user-auth-test",
      },
    });
    await expect(authStore.getUserBySessionToken("plain-session-token")).resolves.toEqual(session.user);

    const storedSession = await pool.query("SELECT token_hash FROM auth_sessions");
    expect(storedSession.rows[0].token_hash).not.toBe("plain-session-token");
    expect(storedSession.rows[0].token_hash).toHaveLength(64);

    const membership = await pool.query("SELECT role FROM workspace_members WHERE user_id = $1", [session.user.id]);
    expect(membership.rows).toEqual([{ role: "owner" }]);
  });

  it("reuses an existing email identity and revokes sessions", async () => {
    const firstSession = await authStore.createSession({ displayName: "林夏", email: "linxia@example.com" });
    const secondSession = await authStore.createSession({ displayName: "林夏 更新", email: "linxia@example.com" });

    expect(secondSession.user.id).toBe(firstSession.user.id);
    expect(secondSession.user.displayName).toBe("林夏 更新");
    await authStore.deleteSession("plain-session-token");
    await expect(authStore.getUserBySessionToken("plain-session-token")).resolves.toBeNull();
  });

  it("rejects invalid profile input", async () => {
    await expect(authStore.createSession({ displayName: "", email: "invalid" })).rejects.toThrow(
      "请输入有效的姓名和邮箱",
    );
  });

  it("uses a hashed session cache and falls back to PostgreSQL when the cache fails", async () => {
    const sessionCache = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      set: vi.fn().mockResolvedValue(undefined),
    };
    const workspaceStore = new PostgresWorkspaceStore(pool, { idFactory: () => "workspace-cache-test" });
    const cachedStore = new PostgresAuthStore(pool, workspaceStore, {
      now: () => 1000,
      sessionCache,
      sessionTokenFactory: () => "cached-session-token",
      userIdFactory: () => "user-cache-test",
    });
    const session = await cachedStore.createSession({ displayName: "周宁", email: "cache@example.com" });
    const tokenHash = createHash("sha256").update(session.token).digest("hex");

    expect(sessionCache.set).toHaveBeenCalledWith(tokenHash, session.user, 5 * 60 * 1000);

    sessionCache.get.mockResolvedValueOnce(session.user);
    const querySpy = vi.spyOn(pool, "query");
    await expect(cachedStore.getUserBySessionToken(session.token)).resolves.toEqual(session.user);
    expect(querySpy).not.toHaveBeenCalled();

    sessionCache.get.mockRejectedValueOnce(new Error("redis unavailable"));
    await expect(cachedStore.getUserBySessionToken(session.token)).resolves.toEqual(session.user);
    expect(querySpy).toHaveBeenCalled();

    await cachedStore.deleteSession(session.token);
    expect(sessionCache.delete).toHaveBeenCalledWith(tokenHash);
  });

  it("registers a normalized password user with a hashed verification code", async () => {
    const registration = await authStore.register({
      displayName: " 林夏 ",
      email: "LINXIA@Example.com ",
      password: "correct horse battery staple",
    });

    expect(registration).toEqual({
      code: "123456",
      user: {
        displayName: "林夏",
        email: "linxia@example.com",
        id: "user-auth-test",
      },
    });
    expect(passwordHasher.hash).toHaveBeenCalledWith("correct horse battery staple");

    const user = await pool.query(
      "SELECT email, password_hash, email_verified_at FROM app_users WHERE id = $1",
      [registration.user.id],
    );
    expect(user.rows).toEqual([{
      email: "linxia@example.com",
      email_verified_at: null,
      password_hash: "hashed:correct horse battery staple",
    }]);

    const code = await pool.query("SELECT token_hash, purpose, expires_at FROM auth_tokens");
    expect(code.rows).toEqual([{
      expires_at: 1000 + 10 * 60 * 1000,
      purpose: "verify-email",
      token_hash: hashAuthCode({
        code: "123456",
        hashSecret: "test-auth-code-secret",
        purpose: "verify-email",
        userId: "user-auth-test",
      }),
    }]);
    expect(JSON.stringify(code.rows)).not.toContain("123456");
  });

  it("upgrades a credentialless legacy account without replacing its workspace", async () => {
    const legacySession = await authStore.createSession({
      displayName: "旧账号",
      email: "legacy@example.com",
    });
    const membershipBefore = await pool.query(
      "SELECT workspace_id, role FROM workspace_members WHERE user_id = $1",
      [legacySession.user.id],
    );

    const registration = await authStore.register({
      displayName: "新姓名",
      email: "LEGACY@example.com ",
      password: "replacement secure password",
    });

    expect(registration).toEqual({
      code: "123456",
      user: {
        displayName: "新姓名",
        email: "legacy@example.com",
        id: legacySession.user.id,
      },
    });
    const storedUser = await pool.query(
      "SELECT display_name, password_hash, email_verified_at FROM app_users WHERE id = $1",
      [legacySession.user.id],
    );
    expect(storedUser.rows).toEqual([{
      display_name: "新姓名",
      email_verified_at: null,
      password_hash: "hashed:replacement secure password",
    }]);
    const membershipAfter = await pool.query(
      "SELECT workspace_id, role FROM workspace_members WHERE user_id = $1",
      [legacySession.user.id],
    );
    expect(membershipAfter.rows).toEqual(membershipBefore.rows);
    await expect(authStore.loginWithPassword({
      email: legacySession.user.email,
      password: "replacement secure password",
    })).rejects.toThrow("该邮箱尚未完成注册，请先完成注册再登录");
    await expect(authStore.verifyEmail({
      code: registration.code,
      email: legacySession.user.email,
    })).resolves.toMatchObject({ user: { id: legacySession.user.id } });
  });

  it("resends only the latest verification code for the same unverified credentials", async () => {
    await authStore.register({
      displayName: "林夏",
      email: "linxia@example.com",
      password: "correct horse battery staple",
    });

    now += 60_000;
    await expect(authStore.register({
      displayName: "林夏",
      email: "LINXIA@example.com",
      password: "correct horse battery staple",
    })).resolves.toMatchObject({ code: "654321" });

    const codes = await pool.query("SELECT token_hash FROM auth_tokens WHERE purpose = 'verify-email'");
    expect(codes.rows).toHaveLength(1);
    await expect(authStore.verifyEmail({
      code: "123456",
      email: "linxia@example.com",
    })).rejects.toThrow("邮箱验证码错误，请重新输入");
    await expect(authStore.verifyEmail({
      code: "654321",
      email: "linxia@example.com",
    })).resolves.toMatchObject({ user: { email: "linxia@example.com" } });
  });

  it("enforces a 60-second verification-code resend cooldown", async () => {
    await authStore.register({
      displayName: "林夏",
      email: "linxia@example.com",
      password: "correct horse battery staple",
    });

    now += 59_000;
    await expect(authStore.register({
      displayName: "林夏",
      email: "LINXIA@example.com",
      password: "correct horse battery staple",
    })).rejects.toMatchObject({
      message: "请在 1 秒后重新发送验证码",
      retryAfterSeconds: 1,
    });

    const existingCode = await pool.query(
      "SELECT token_hash FROM auth_tokens WHERE user_id = $1 AND purpose = 'verify-email'",
      ["user-auth-test"],
    );
    expect(existingCode.rows).toEqual([{
      token_hash: hashAuthCode({
        code: "123456",
        hashSecret: "test-auth-code-secret",
        purpose: "verify-email",
        userId: "user-auth-test",
      }),
    }]);

    now += 1_000;
    await expect(authStore.register({
      displayName: "林夏",
      email: "linxia@example.com",
      password: "correct horse battery staple",
    })).resolves.toMatchObject({ code: "654321" });
  });

  it("maps a concurrent initial registration to the resend cooldown", async () => {
    const registration = {
      displayName: "林夏",
      email: "linxia@example.com",
      password: "correct horse battery staple",
    };
    const results = await Promise.allSettled([
      authStore.register(registration),
      authStore.register(registration),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: {
        message: "请在 60 秒后重新发送验证码",
        retryAfterSeconds: 60,
      },
    });
    const users = await pool.query("SELECT id FROM app_users WHERE email = $1", [registration.email]);
    const codes = await pool.query(
      "SELECT token_hash FROM auth_tokens WHERE user_id = $1 AND purpose = 'verify-email'",
      ["user-auth-test"],
    );
    expect(users.rows).toHaveLength(1);
    expect(codes.rows).toHaveLength(1);
  });

  it("rejects duplicate registration with different credentials", async () => {
    await authStore.register({
      displayName: "林夏",
      email: "linxia@example.com",
      password: "correct horse battery staple",
    });

    await expect(authStore.register({
      displayName: "冒用者",
      email: "LINXIA@example.com",
      password: "another secure password",
    })).rejects.toThrow("该邮箱存在未完成的注册，当前密码与首次注册密码不一致；请使用首次密码或找回密码");

    const result = await pool.query("SELECT display_name FROM app_users WHERE email = $1", ["linxia@example.com"]);
    expect(result.rows).toEqual([{ display_name: "林夏" }]);
  });

  it("explains why an existing verified account cannot register again", async () => {
    await authStore.register({
      displayName: "林夏",
      email: "linxia@example.com",
      password: "correct horse battery staple",
    });
    await authStore.verifyEmail({ code: "123456", email: "linxia@example.com" });

    await expect(authStore.register({
      displayName: "林夏",
      email: "linxia@example.com",
      password: "correct horse battery staple",
    })).rejects.toThrow("该邮箱已注册，请直接登录或使用找回密码");
  });

  it("explains invalid login fields and account states", async () => {
    await expect(authStore.loginWithPassword({
      email: "invalid-email",
      password: "correct horse battery staple",
    })).rejects.toThrow("请输入有效的邮箱地址");
    await expect(authStore.loginWithPassword({
      email: "missing@example.com",
      password: "correct horse battery staple",
    })).rejects.toThrow("该邮箱尚未注册，请先创建账号");

    await authStore.createSession({
      displayName: "旧账号",
      email: "legacy@example.com",
    });
    await expect(authStore.loginWithPassword({
      email: "legacy@example.com",
      password: "correct horse battery staple",
    })).rejects.toThrow("该账号尚未设置密码，请使用找回密码设置密码");
  });

  it("explains verification-code format, request, content, and expiry errors", async () => {
    await expect(authStore.verifyEmail({
      code: "12ab",
      email: "missing@example.com",
    })).rejects.toThrow("验证码必须是 6 位数字");
    await expect(authStore.verifyEmail({
      code: "123456",
      email: "missing@example.com",
    })).rejects.toThrow("该邮箱尚未注册，请先创建账号");

    await authStore.register({
      displayName: "林夏",
      email: "linxia@example.com",
      password: "correct horse battery staple",
    });
    await expect(authStore.verifyEmail({
      code: "999999",
      email: "linxia@example.com",
    })).rejects.toThrow("邮箱验证码错误，请重新输入");

    now += 10 * 60 * 1000;
    await expect(authStore.verifyEmail({
      code: "123456",
      email: "linxia@example.com",
    })).rejects.toThrow("邮箱验证码已过期，请重新发送");
  });

  it("locks the user row before the verification token when consuming a code", async () => {
    await authStore.register({
      displayName: "林夏",
      email: "linxia@example.com",
      password: "correct horse battery staple",
    });
    const client = await pool.connect();
    const querySpy = vi.spyOn(client, "query");
    const promisePool = pool as unknown as { connect(): Promise<PoolClient> };
    vi.spyOn(promisePool, "connect").mockResolvedValueOnce(client);

    await authStore.verifyEmail({ code: "123456", email: "linxia@example.com" });

    const statements = querySpy.mock.calls.map(([statement]) => String(statement));
    const userLockIndex = statements.findIndex((statement) =>
      statement.includes("FROM app_users WHERE email") && statement.includes("FOR UPDATE"));
    const tokenLockIndex = statements.findIndex((statement) => statement.includes("FROM auth_tokens"));
    expect(userLockIndex).toBeGreaterThanOrEqual(0);
    expect(tokenLockIndex).toBeGreaterThan(userLockIndex);
  });

  it("verifies email once and then permits password login", async () => {
    await authStore.register({
      displayName: "林夏",
      email: "linxia@example.com",
      password: "correct horse battery staple",
    });

    await expect(authStore.loginWithPassword({
      email: "linxia@example.com",
      password: "correct horse battery staple",
    })).rejects.toThrow("该邮箱尚未完成注册，请先完成注册再登录");

    await expect(authStore.verifyEmail({
      code: "123456",
      email: "linxia@example.com",
    })).resolves.toMatchObject({
      token: "plain-session-token",
      user: { email: "linxia@example.com" },
    });
    await expect(authStore.verifyEmail({
      code: "123456",
      email: "linxia@example.com",
    })).rejects.toThrow("尚未发送邮箱验证码，请先重新发送");
    await expect(authStore.loginWithPassword({
      email: "LINXIA@example.com ",
      password: "correct horse battery staple",
    })).resolves.toMatchObject({
      token: "replacement-session-token",
      user: { email: "linxia@example.com" },
    });
    await expect(authStore.loginWithPassword({
      email: "linxia@example.com",
      password: "wrong password",
    })).rejects.toThrow("密码错误，请重新输入");
  });

  it("lets a legacy user reset a password once and revokes previous sessions", async () => {
    const legacySession = await authStore.createSession({
      displayName: "旧账号",
      email: "legacy@example.com",
    });
    const reset = await authStore.createPasswordReset("legacy@example.com");

    expect(reset).toEqual({ code: "123456", user: legacySession.user });
    const replacement = await authStore.resetPassword({
      code: "123456",
      email: "legacy@example.com",
      password: "replacement secure password",
    });

    await expect(authStore.getUserBySessionToken(legacySession.token)).resolves.toBeNull();
    await expect(authStore.getUserBySessionToken(replacement.token)).resolves.toEqual(replacement.user);
    await expect(authStore.resetPassword({
      code: "123456",
      email: "legacy@example.com",
      password: "another replacement password",
    })).rejects.toThrow("尚未发送密码重置验证码，请先重新发送");

    const user = await pool.query(
      "SELECT password_hash, email_verified_at FROM app_users WHERE id = $1",
      [legacySession.user.id],
    );
    expect(user.rows[0].password_hash).toBe("hashed:replacement secure password");
    expect(Number(user.rows[0].email_verified_at)).toBe(1000);
  });

  it("does not reveal whether a password reset email exists", async () => {
    await expect(authStore.createPasswordReset("missing@example.com")).resolves.toBeNull();
  });

  it("enforces the password-reset cooldown and serializes concurrent sends", async () => {
    const legacySession = await authStore.createSession({
      displayName: "旧账号",
      email: "legacy@example.com",
    });
    await authStore.createPasswordReset(legacySession.user.email);

    now += 59_000;
    await expect(authStore.createPasswordReset(legacySession.user.email)).rejects.toMatchObject({
      message: "请在 1 秒后重新发送验证码",
      retryAfterSeconds: 1,
    });

    now += 1_000;
    await expect(authStore.createPasswordReset(legacySession.user.email)).resolves.toMatchObject({
      code: "654321",
    });

    now += 60_000;
    const results = await Promise.allSettled([
      authStore.createPasswordReset(legacySession.user.email),
      authStore.createPasswordReset(legacySession.user.email),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({
      reason: {
        message: "请在 60 秒后重新发送验证码",
        retryAfterSeconds: 60,
      },
    });
    const codes = await pool.query(
      "SELECT token_hash FROM auth_tokens WHERE user_id = $1 AND purpose = 'reset-password'",
      [legacySession.user.id],
    );
    expect(codes.rows).toHaveLength(1);
  });

  it("links a verified OAuth profile to an existing email identity", async () => {
    await authStore.register({
      displayName: "林夏",
      email: "linxia@example.com",
      password: "correct horse battery staple",
    });
    await authStore.verifyEmail({ code: "123456", email: "linxia@example.com" });

    const first = await authStore.loginWithOAuth({
      displayName: "GitHub 林夏",
      email: "LINXIA@example.com",
      provider: "github",
      providerAccountId: "github-42",
    });
    const second = await authStore.loginWithOAuth({
      displayName: "Changed GitHub Name",
      email: "changed@example.com",
      provider: "github",
      providerAccountId: "github-42",
    });

    expect(first.user.id).toBe("user-auth-test");
    expect(second.user.id).toBe(first.user.id);
    const accounts = await pool.query("SELECT provider, provider_account_id, user_id FROM oauth_accounts");
    expect(accounts.rows).toEqual([{
      provider: "github",
      provider_account_id: "github-42",
      user_id: "user-auth-test",
    }]);
  });

  it("creates a verified user and personal workspace for a new OAuth identity", async () => {
    const session = await authStore.loginWithOAuth({
      displayName: "周宁",
      email: "zhouning@example.com",
      provider: "github",
      providerAccountId: "github-84",
    });

    expect(session.user).toEqual({
      displayName: "周宁",
      email: "zhouning@example.com",
      id: "user-auth-test",
    });
    const user = await pool.query("SELECT email_verified_at, password_hash FROM app_users WHERE id = $1", [session.user.id]);
    expect(Number(user.rows[0].email_verified_at)).toBe(1000);
    expect(user.rows[0].password_hash).toBeNull();
    const membership = await pool.query("SELECT role FROM workspace_members WHERE user_id = $1", [session.user.id]);
    expect(membership.rows).toEqual([{ role: "owner" }]);
  });

  it("records redacted authentication audit events", async () => {
    const ipHash = "a".repeat(64);
    await authStore.recordAuditEvent({
      eventType: "password-login",
      ipHash,
      succeeded: false,
      userId: null,
    });

    const events = await pool.query(
      "SELECT event_type, ip_hash, succeeded, user_id FROM auth_audit_events",
    );
    expect(events.rows).toEqual([{
      event_type: "password-login",
      ip_hash: ipHash,
      succeeded: false,
      user_id: null,
    }]);
    expect(JSON.stringify(events.rows)).not.toContain("127.0.0.1");
  });
});
