import { createHmac } from "node:crypto";
import { createClient } from "redis";

export interface AuthRateLimitRule {
  action: string;
  identifier: string;
  limit: number;
  windowMs: number;
}

export interface AuthRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface AuthRateLimiter {
  consume(rule: AuthRateLimitRule): Promise<AuthRateLimitResult>;
  reset(rule: Pick<AuthRateLimitRule, "action" | "identifier">): Promise<void>;
}

interface RedisRateLimitClient {
  readonly isOpen: boolean;
  connect(): Promise<unknown>;
  del(key: string): Promise<number>;
  eval(
    script: string,
    options: { arguments: string[]; keys: string[] },
  ): Promise<unknown>;
}

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

export class AuthRateLimitUnavailableError extends Error {
  constructor() {
    super("认证限流服务不可用");
    this.name = "AuthRateLimitUnavailableError";
  }
}

export class RedisAuthRateLimiter implements AuthRateLimiter {
  private connectPromise: Promise<unknown> | null = null;

  constructor(
    private readonly client: RedisRateLimitClient,
    private readonly hashSecret: string,
  ) {}

  async consume(rule: AuthRateLimitRule): Promise<AuthRateLimitResult> {
    validateRule(rule);
    await this.ensureConnected();
    const key = createRateLimitKey(rule.action, rule.identifier, this.hashSecret);
    const result = await this.client.eval(RATE_LIMIT_SCRIPT, {
      arguments: [String(rule.windowMs)],
      keys: [key],
    });
    if (!Array.isArray(result) || result.length < 2) {
      throw new AuthRateLimitUnavailableError();
    }

    const count = Number(result[0]);
    const retryAfterMs = Math.max(Number(result[1]), 0);
    if (!Number.isFinite(count) || !Number.isFinite(retryAfterMs)) {
      throw new AuthRateLimitUnavailableError();
    }

    return {
      allowed: count <= rule.limit,
      remaining: Math.max(rule.limit - count, 0),
      retryAfterMs,
    };
  }

  async reset(rule: Pick<AuthRateLimitRule, "action" | "identifier">) {
    await this.ensureConnected();
    await this.client.del(createRateLimitKey(rule.action, rule.identifier, this.hashSecret));
  }

  private async ensureConnected() {
    if (this.client.isOpen) {
      return;
    }
    this.connectPromise ??= this.client.connect().finally(() => {
      this.connectPromise = null;
    });
    await this.connectPromise;
  }
}

export class InMemoryAuthRateLimiter implements AuthRateLimiter {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();

  constructor(
    private readonly hashSecret: string,
    private readonly now: () => number = Date.now,
  ) {}

  async consume(rule: AuthRateLimitRule): Promise<AuthRateLimitResult> {
    validateRule(rule);
    const now = this.now();
    const key = createRateLimitKey(rule.action, rule.identifier, this.hashSecret);
    const existing = this.entries.get(key);
    const entry = !existing || existing.expiresAt <= now
      ? { count: 0, expiresAt: now + rule.windowMs }
      : existing;
    entry.count += 1;
    this.entries.set(key, entry);

    return {
      allowed: entry.count <= rule.limit,
      remaining: Math.max(rule.limit - entry.count, 0),
      retryAfterMs: Math.max(entry.expiresAt - now, 0),
    };
  }

  async reset(rule: Pick<AuthRateLimitRule, "action" | "identifier">) {
    this.entries.delete(createRateLimitKey(rule.action, rule.identifier, this.hashSecret));
  }
}

class UnavailableAuthRateLimiter implements AuthRateLimiter {
  async consume(): Promise<AuthRateLimitResult> {
    throw new AuthRateLimitUnavailableError();
  }

  async reset(): Promise<void> {
    throw new AuthRateLimitUnavailableError();
  }
}

class DevelopmentFallbackRateLimiter implements AuthRateLimiter {
  constructor(
    private readonly primary: AuthRateLimiter,
    private readonly fallback: AuthRateLimiter,
  ) {}

  async consume(rule: AuthRateLimitRule) {
    try {
      return await this.primary.consume(rule);
    } catch {
      return this.fallback.consume(rule);
    }
  }

  async reset(rule: Pick<AuthRateLimitRule, "action" | "identifier">) {
    try {
      await this.primary.reset(rule);
    } catch {
      // The development fallback remains authoritative while Redis is unavailable.
    }
    await this.fallback.reset(rule);
  }
}

export function createAuthRateLimiter({
  hashSecret,
  production,
  redisUrl,
}: {
  hashSecret: string;
  production: boolean;
  redisUrl: string | undefined;
}): AuthRateLimiter {
  const url = redisUrl?.trim();
  if (!url) {
    return production
      ? new UnavailableAuthRateLimiter()
      : new InMemoryAuthRateLimiter(hashSecret);
  }

  const client = createClient({
    socket: {
      connectTimeout: 1000,
      reconnectStrategy: false,
    },
    url,
  });
  client.on("error", () => undefined);
  const redisLimiter = new RedisAuthRateLimiter(client as RedisRateLimitClient, hashSecret);
  return production
    ? redisLimiter
    : new DevelopmentFallbackRateLimiter(redisLimiter, new InMemoryAuthRateLimiter(hashSecret));
}

export function hashAuthIdentifier(identifier: string, hashSecret: string) {
  return createHmac("sha256", hashSecret)
    .update(identifier.trim().toLowerCase())
    .digest("hex");
}

function createRateLimitKey(action: string, identifier: string, hashSecret: string) {
  return `notion-editor:auth-rate:${action}:${hashAuthIdentifier(identifier, hashSecret)}`;
}

function validateRule(rule: AuthRateLimitRule) {
  if (!rule.action || !rule.identifier || !Number.isInteger(rule.limit) || rule.limit <= 0 || !Number.isInteger(rule.windowMs) || rule.windowMs <= 0) {
    throw new Error("认证限流规则无效");
  }
}
