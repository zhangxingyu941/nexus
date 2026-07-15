import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { createAuthDomainError } from "./authErrors";
import { createAuthCode, hashAuthCode, type AuthTokenPurpose } from "./authTokens";
import { Argon2PasswordHasher, type PasswordHasher } from "./passwordHasher";
import type { PostgresWorkspaceStore } from "./postgresWorkspaceStore";

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
}

export interface CreateSessionInput {
  displayName: string;
  email: string;
}

export interface RegisterInput extends CreateSessionInput {
  password: string;
}

export interface PasswordLoginInput {
  email: string;
  password: string;
}

export interface ResetPasswordInput {
  code: string;
  email: string;
  password: string;
}

export interface OAuthIdentityInput {
  displayName: string;
  email: string;
  provider: "github";
  providerAccountId: string;
}

export interface PendingAuthCode {
  code: string;
  user: AppUser;
}

export interface CreatedSession {
  expiresAt: number;
  token: string;
  user: AppUser;
}

export interface SessionCache {
  delete(tokenHash: string): Promise<void>;
  get(tokenHash: string): Promise<AppUser | null>;
  set(tokenHash: string, user: AppUser, ttlMs: number): Promise<void>;
}

interface PostgresAuthStoreOptions {
  auditEventIdFactory?: () => string;
  authCodeFactory?: () => string;
  authCodeSecret?: string;
  now?: () => number;
  passwordHasher?: PasswordHasher;
  sessionCache?: SessionCache;
  sessionTokenFactory?: () => string;
  userIdFactory?: () => string;
}

/** 登录会话有效期：30 天 */
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
/** 会话 Redis 缓存过期时间：5 分钟，过期后回落到 PostgreSQL 查询 */
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000;
/** 邮箱验证码 / 密码重置验证码有效期：10 分钟 */
const AUTH_CODE_DURATION_MS = 10 * 60 * 1000;
/** 验证码重发冷却时间：60 秒（导出供路由层限流使用） */
export const AUTH_CODE_COOLDOWN_SECONDS = 60;
const AUTH_CODE_COOLDOWN_MS = AUTH_CODE_COOLDOWN_SECONDS * 1000;
/**
 * 伪装的 Argon2id 哈希，用于用户不存在时的验证比对。
 * 始终返回验证失败，但耗时与真实哈希一致，防止通过响应时间枚举邮箱。
 */
const DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$kOtkpU07XR0sNU9dXLue0Q$YsE0y/2v6ifP7WYrMdTygQlUPyurEDX5tAI7u74q3YU";

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export class AuthCodeCooldownError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`请在 ${retryAfterSeconds} 秒后重新发送验证码`);
    this.name = "AuthCodeCooldownError";
  }
}

export class PostgresAuthStore {
  private readonly auditEventIdFactory: () => string;
  private readonly authCodeFactory?: () => string;
  private readonly authCodeOperations = new Map<string, Promise<unknown>>();
  private readonly authCodeSecret: string;
  private readonly now: () => number;
  private readonly passwordHasher: PasswordHasher;
  private readonly sessionTokenFactory: () => string;
  private readonly sessionCache?: SessionCache;
  private readonly userIdFactory: () => string;

  constructor(
    private readonly pool: Pool,
    private readonly workspaceStore: PostgresWorkspaceStore,
    options: PostgresAuthStoreOptions = {},
  ) {
    this.auditEventIdFactory = options.auditEventIdFactory ?? (() => `audit-${randomUUID()}`);
    this.authCodeFactory = options.authCodeFactory ?? undefined;
    this.authCodeSecret = options.authCodeSecret?.trim()
      || process.env.AUTH_HASH_SECRET?.trim()
      || (process.env.NODE_ENV === "production" ? "" : "development-only-auth-code-secret");
    if (!this.authCodeSecret) {
      throw new Error("AUTH_HASH_SECRET 未配置");
    }
    this.now = options.now ?? Date.now;
    this.passwordHasher = options.passwordHasher ?? new Argon2PasswordHasher();
    this.sessionCache = options.sessionCache;
    this.sessionTokenFactory = options.sessionTokenFactory ?? (() => randomBytes(32).toString("base64url"));
    this.userIdFactory = options.userIdFactory ?? (() => `user-${randomUUID()}`);
  }

  async createSession(input: CreateSessionInput): Promise<CreatedSession> {
    const displayName = input.displayName.trim();
    const email = input.email.trim().toLowerCase();

    if (!displayName || displayName.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("请输入有效的姓名和邮箱");
    }

    const now = this.now();
    const userResult = await this.pool.query(
      `INSERT INTO app_users (id, email, display_name, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id, email, display_name`,
      [this.userIdFactory(), email, displayName, now],
    );
    const user: AppUser = {
      displayName: String(userResult.rows[0].display_name),
      email: String(userResult.rows[0].email),
      id: String(userResult.rows[0].id),
    };

    await this.workspaceStore.ensurePersonalWorkspace(user.id, `${user.displayName}的工作区`);

    return this.issueSession(user, now);
  }

  async register(input: RegisterInput): Promise<PendingAuthCode> {
    const displayName = validateDisplayName(input.displayName);
    const email = validateEmail(input.email);
    validatePassword(input.password);

    return this.runSerializedAuthCodeOperation(`registration:${email}`, "verify-email", () =>
      this.registerValidated({ displayName, email, password: input.password }));
  }

  private async registerValidated(input: RegisterInput): Promise<PendingAuthCode> {
    const { displayName, email } = input;
    const existing = await this.pool.query(
      "SELECT id, email, display_name, password_hash, email_verified_at FROM app_users WHERE email = $1",
      [email],
    );
    const existingRow = existing.rows[0];
    if (existingRow) {
      return this.continueRegistration(existingRow, input);
    }

    const now = this.now();
    const passwordHash = await this.passwordHasher.hash(input.password);
    const user: AppUser = { displayName, email, id: this.userIdFactory() };
    const code = this.createCode(user.id, "verify-email");

    try {
      await this.withTransaction(async (client) => {
        await client.query(
          `INSERT INTO app_users
           (id, email, display_name, password_hash, email_verified_at, updated_at, created_at)
           VALUES ($1, $2, $3, $4, NULL, $5, $5)`,
          [user.id, user.email, user.displayName, passwordHash, now],
        );
        await this.workspaceStore.ensurePersonalWorkspace(user.id, `${user.displayName}的工作区`, client);
        await this.insertAuthCode(client, user.id, "verify-email", code, now);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.pool.query(
          "SELECT id, email, display_name, password_hash, email_verified_at FROM app_users WHERE email = $1",
          [email],
        );
        if (raced.rows[0]) {
          return this.continueRegistration(raced.rows[0], input);
        }
        throw new Error("无法创建账号");
      }
      throw error;
    }

    return { code, user };
  }

  async loginWithPassword(input: PasswordLoginInput): Promise<CreatedSession> {
    const email = validateEmail(input.email);
    validatePassword(input.password);
    const result = await this.pool.query(
      `SELECT id, email, display_name, password_hash, email_verified_at
       FROM app_users
       WHERE email = $1`,
      [email],
    );
    const row = result.rows[0];
    const passwordMatches = await this.passwordHasher.verify(
      row?.password_hash ? String(row.password_hash) : DUMMY_PASSWORD_HASH,
      input.password,
    );

    if (!row) {
      throw createAuthDomainError("email_not_registered");
    }
    if (!row.password_hash) {
      throw createAuthDomainError("password_not_set");
    }
    if (row.email_verified_at === null) {
      throw createAuthDomainError("email_not_verified");
    }
    if (!passwordMatches) {
      throw createAuthDomainError("password_incorrect");
    }

    return this.issueSession(toAppUser(row), this.now());
  }

  async verifyEmail(input: { code: string; email: string }): Promise<CreatedSession> {
    const now = this.now();
    const email = validateEmail(input.email);
    validateAuthCode(input.code);

    const user = await this.withTransaction(async (client) => {
      const row = await this.getValidAuthCode(client, email, input.code, "verify-email", now);

      await client.query(
        "UPDATE auth_tokens SET consumed_at = $1 WHERE token_hash = $2",
        [now, this.hashCode(row.id, "verify-email", input.code)],
      );
      await client.query(
        "UPDATE app_users SET email_verified_at = COALESCE(email_verified_at, $1), updated_at = $1 WHERE id = $2",
        [now, row.id],
      );

      return toAppUser(row);
    });

    return this.issueSession(user, now);
  }

  async createPasswordReset(emailInput: string): Promise<PendingAuthCode | null> {
    const email = validateEmail(emailInput);
    const result = await this.pool.query(
      "SELECT id, email, display_name FROM app_users WHERE email = $1",
      [email],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const now = this.now();
    const user = toAppUser(row);
    const code = await this.runSerializedAuthCodeOperation(user.id, "reset-password", () =>
      this.withTransaction((client) => this.replaceAuthCode(client, user.id, "reset-password", now)));

    return { code, user };
  }

  async resetPassword(input: ResetPasswordInput): Promise<CreatedSession> {
    validatePassword(input.password);
    const now = this.now();
    const email = validateEmail(input.email);
    validateAuthCode(input.code);
    const passwordHash = await this.passwordHasher.hash(input.password);
    const revokedTokenHashes: string[] = [];

    const user = await this.withTransaction(async (client) => {
      const row = await this.getValidAuthCode(client, email, input.code, "reset-password", now);

      const sessions = await client.query(
        "SELECT token_hash FROM auth_sessions WHERE user_id = $1",
        [row.id],
      );
      revokedTokenHashes.push(...sessions.rows.map((session) => String(session.token_hash)));

      await client.query(
        `UPDATE app_users
         SET password_hash = $1,
             email_verified_at = COALESCE(email_verified_at, $2),
             updated_at = $2
         WHERE id = $3`,
        [passwordHash, now, row.id],
      );
      await client.query("DELETE FROM auth_sessions WHERE user_id = $1", [row.id]);
      await client.query(
        "DELETE FROM auth_tokens WHERE user_id = $1 AND purpose = 'reset-password'",
        [row.id],
      );

      return toAppUser(row);
    });

    await this.deleteCachedSessions(revokedTokenHashes);
    return this.issueSession(user, now);
  }

  async loginWithOAuth(input: OAuthIdentityInput): Promise<CreatedSession> {
    const email = normalizeEmail(input.email);
    const displayName = input.displayName.trim().slice(0, 80);
    const providerAccountId = input.providerAccountId.trim();
    if (!displayName || !providerAccountId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("OAuth 账号信息无效");
    }

    const now = this.now();
    const user = await this.withTransaction(async (client) => {
      const linkedAccount = await client.query(
        `SELECT users.id, users.email, users.display_name
         FROM oauth_accounts accounts
         INNER JOIN app_users users ON users.id = accounts.user_id
         WHERE accounts.provider = $1 AND accounts.provider_account_id = $2
         FOR UPDATE`,
        [input.provider, providerAccountId],
      );
      if (linkedAccount.rows[0]) {
        await client.query(
          `UPDATE oauth_accounts
           SET provider_email = $1, updated_at = $2
           WHERE provider = $3 AND provider_account_id = $4`,
          [email, now, input.provider, providerAccountId],
        );
        return toAppUser(linkedAccount.rows[0]);
      }

      const existingUser = await client.query(
        "SELECT id, email, display_name FROM app_users WHERE email = $1 FOR UPDATE",
        [email],
      );
      let appUser: AppUser;
      if (existingUser.rows[0]) {
        appUser = toAppUser(existingUser.rows[0]);
        await client.query(
          `UPDATE app_users
           SET email_verified_at = COALESCE(email_verified_at, $1), updated_at = $1
           WHERE id = $2`,
          [now, appUser.id],
        );
      } else {
        appUser = { displayName, email, id: this.userIdFactory() };
        await client.query(
          `INSERT INTO app_users
           (id, email, display_name, password_hash, email_verified_at, updated_at, created_at)
           VALUES ($1, $2, $3, NULL, $4, $4, $4)`,
          [appUser.id, appUser.email, appUser.displayName, now],
        );
        await this.workspaceStore.ensurePersonalWorkspace(
          appUser.id,
          `${appUser.displayName}的工作区`,
          client,
        );
      }

      await client.query(
        `INSERT INTO oauth_accounts
         (provider, provider_account_id, user_id, provider_email, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [input.provider, providerAccountId, appUser.id, email, now],
      );
      return appUser;
    });

    return this.issueSession(user, now);
  }

  async recordAuditEvent(input: {
    eventType: string;
    ipHash: string;
    succeeded: boolean;
    userId: string | null;
  }) {
    if (!input.eventType || input.eventType.length > 64 || !/^[a-f0-9-]{16,128}$/i.test(input.ipHash)) {
      throw new Error("认证审计事件无效");
    }
    await this.pool.query(
      `INSERT INTO auth_audit_events
       (id, event_type, user_id, ip_hash, succeeded, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        this.auditEventIdFactory(),
        input.eventType,
        input.userId,
        input.ipHash,
        input.succeeded,
        this.now(),
      ],
    );
  }

  async getUserBySessionToken(token: string): Promise<AppUser | null> {
    if (!token) {
      return null;
    }

    const tokenHash = hashSessionToken(token);
    if (this.sessionCache) {
      try {
        const cachedUser = await this.sessionCache.get(tokenHash);
        if (cachedUser) {
          return cachedUser;
        }
      } catch {
        // Redis is an optimization; PostgreSQL remains the authentication authority.
      }
    }

    const now = this.now();
    const result = await this.pool.query(
      `SELECT users.id, users.email, users.display_name, sessions.expires_at
       FROM auth_sessions sessions
       INNER JOIN app_users users ON users.id = sessions.user_id
       WHERE sessions.token_hash = $1 AND sessions.expires_at > $2`,
      [tokenHash, now],
    );
    const row = result.rows[0];

    const user = row
      ? {
          displayName: String(row.display_name),
          email: String(row.email),
          id: String(row.id),
        }
      : null;
    if (user) {
      await this.writeSessionCache(tokenHash, user, Math.max(Number(row.expires_at) - now, 1));
    }

    return user;
  }

  async deleteSession(token: string) {
    if (!token) {
      return;
    }

    const tokenHash = hashSessionToken(token);
    try {
      await this.pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash]);
    } finally {
      if (this.sessionCache) {
        try {
          await this.sessionCache.delete(tokenHash);
        } catch {
          // The database revocation succeeds even when Redis is unavailable.
        }
      }
    }
  }

  private async issueSession(user: AppUser, now: number): Promise<CreatedSession> {
    const token = this.sessionTokenFactory();
    const expiresAt = now + SESSION_DURATION_MS;
    const tokenHash = hashSessionToken(token);
    await this.pool.query(
      `INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (token_hash) DO UPDATE
       SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at, created_at = EXCLUDED.created_at`,
      [tokenHash, user.id, expiresAt, now],
    );
    await this.writeSessionCache(tokenHash, user, expiresAt - now);

    return { expiresAt, token, user };
  }

  private createCode(userId: string, purpose: AuthTokenPurpose) {
    const code = createAuthCode(this.authCodeFactory);
    this.hashCode(userId, purpose, code);
    return code;
  }

  private async continueRegistration(existingRow: Record<string, unknown>, input: RegisterInput) {
    const passwordHash = existingRow.password_hash
      ? null
      : await this.passwordHasher.hash(input.password);
    const now = this.now();

    return this.withTransaction(async (client) => {
      const locked = await client.query(
        `SELECT id, email, display_name, password_hash, email_verified_at
         FROM app_users
         WHERE id = $1
         FOR UPDATE`,
        [existingRow.id],
      );
      const row = locked.rows[0];
      if (!row) {
        throw createAuthDomainError("email_not_registered");
      }
      if (row.email_verified_at !== null) {
        throw createAuthDomainError(row.password_hash
          ? "email_already_registered"
          : "external_account_requires_password");
      }

      if (row.password_hash) {
        const passwordMatches = await this.passwordHasher.verify(String(row.password_hash), input.password);
        if (!passwordMatches) {
          throw createAuthDomainError("registration_password_mismatch");
        }
      } else {
        await client.query(
          `UPDATE app_users
           SET display_name = $1, password_hash = $2, updated_at = $3
           WHERE id = $4`,
          [input.displayName, passwordHash, now, row.id],
        );
        row.display_name = input.displayName;
      }

      const user = toAppUser(row);
      const code = await this.replaceAuthCode(client, user.id, "verify-email", now);
      return { code, user };
    });
  }

  private hashCode(userId: string, purpose: AuthTokenPurpose, code: string) {
    return hashAuthCode({
      code,
      hashSecret: this.authCodeSecret,
      purpose,
      userId,
    });
  }

  private async insertAuthCode(
    client: PoolClient,
    userId: string,
    purpose: AuthTokenPurpose,
    code: string,
    now: number,
  ) {
    await client.query(
      `INSERT INTO auth_tokens
       (token_hash, user_id, purpose, expires_at, created_at, consumed_at)
       VALUES ($1, $2, $3, $4, $5, NULL)`,
      [this.hashCode(userId, purpose, code), userId, purpose, now + AUTH_CODE_DURATION_MS, now],
    );
  }

  private async replaceAuthCode(
    client: PoolClient,
    userId: string,
    purpose: AuthTokenPurpose,
    now: number,
  ) {
    await client.query("SELECT id FROM app_users WHERE id = $1 FOR UPDATE", [userId]);
    const latest = await client.query(
      `SELECT created_at
       FROM auth_tokens
       WHERE user_id = $1 AND purpose = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, purpose],
    );
    const latestCreatedAt = latest.rows[0]?.created_at;
    if (latestCreatedAt !== undefined && latestCreatedAt !== null) {
      const retryAfterMs = Number(latestCreatedAt) + AUTH_CODE_COOLDOWN_MS - now;
      if (retryAfterMs > 0) {
        throw new AuthCodeCooldownError(Math.ceil(retryAfterMs / 1000));
      }
    }

    const code = this.createCode(userId, purpose);
    await client.query(
      "DELETE FROM auth_tokens WHERE user_id = $1 AND purpose = $2",
      [userId, purpose],
    );
    await this.insertAuthCode(client, userId, purpose, code, now);
    return code;
  }

  private async runSerializedAuthCodeOperation<T>(
    userId: string,
    purpose: AuthTokenPurpose,
    operation: () => Promise<T>,
  ) {
    const key = `${userId}:${purpose}`;
    const previous = this.authCodeOperations.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.authCodeOperations.set(key, current);

    try {
      return await current;
    } finally {
      if (this.authCodeOperations.get(key) === current) {
        this.authCodeOperations.delete(key);
      }
    }
  }

  private async getValidAuthCode(
    client: PoolClient,
    email: string,
    code: string,
    purpose: AuthTokenPurpose,
    now: number,
  ) {
    const userResult = await client.query(
      "SELECT id, email, display_name FROM app_users WHERE email = $1 FOR UPDATE",
      [email],
    );
    const user = userResult.rows[0];
    if (!user) {
      throw createAuthDomainError("email_not_registered");
    }

    const tokenResult = await client.query(
      `SELECT token_hash, expires_at
       FROM auth_tokens
       WHERE user_id = $1
         AND purpose = $2
         AND consumed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1
       FOR UPDATE`,
      [user.id, purpose],
    );
    const token = tokenResult.rows[0];
    const prefix = purpose === "verify-email" ? "verify_code" : "reset_code";
    if (!token) {
      throw createAuthDomainError(`${prefix}_not_requested`);
    }
    if (Number(token.expires_at) <= now) {
      throw createAuthDomainError(`${prefix}_expired`);
    }
    if (String(token.token_hash) !== this.hashCode(String(user.id), purpose, code)) {
      throw createAuthDomainError(`${prefix}_incorrect`);
    }

    return user;
  }

  private async deleteCachedSessions(tokenHashes: string[]) {
    if (!this.sessionCache) {
      return;
    }

    await Promise.all(tokenHashes.map(async (tokenHash) => {
      try {
        await this.sessionCache?.delete(tokenHash);
      } catch {
        // PostgreSQL revocation is authoritative when Redis is unavailable.
      }
    }));
  }

  private async withTransaction<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async writeSessionCache(tokenHash: string, user: AppUser, ttlMs: number) {
    if (!this.sessionCache) {
      return;
    }

    try {
      await this.sessionCache.set(tokenHash, user, Math.min(ttlMs, SESSION_CACHE_TTL_MS));
    } catch {
      // Cache write failures must not block login or authenticated requests.
    }
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function validateDisplayName(displayNameInput: string) {
  const displayName = displayNameInput.trim();
  if (!displayName) {
    throw createAuthDomainError("display_name_required");
  }
  if (displayName.length > 80) {
    throw createAuthDomainError("display_name_too_long");
  }
  return displayName;
}

function validateEmail(emailInput: string) {
  const email = normalizeEmail(emailInput);
  if (!email) {
    throw createAuthDomainError("email_required");
  }
  if (email.length > 254) {
    throw createAuthDomainError("email_too_long");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createAuthDomainError("email_invalid");
  }
  return email;
}

function validatePassword(password: string) {
  if (password.length < 12 || password.length > 128) {
    throw createAuthDomainError("password_length_invalid");
  }
}

function validateAuthCode(code: string) {
  if (!/^\d{6}$/.test(code)) {
    throw createAuthDomainError("auth_code_format_invalid");
  }
}

function toAppUser(row: Record<string, unknown>): AppUser {
  return {
    displayName: String(row.display_name),
    email: String(row.email),
    id: String(row.id),
  };
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}
