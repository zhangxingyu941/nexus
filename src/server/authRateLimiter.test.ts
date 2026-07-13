import { describe, expect, it, vi } from "vitest";
import {
  AuthRateLimitUnavailableError,
  InMemoryAuthRateLimiter,
  RedisAuthRateLimiter,
  createAuthRateLimiter,
} from "./authRateLimiter";

const rule = {
  action: "login",
  identifier: "LINXIA@example.com",
  limit: 3,
  windowMs: 60_000,
};

describe("RedisAuthRateLimiter", () => {
  it("uses an HMAC identifier and returns the Redis counter TTL", async () => {
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      del: vi.fn(),
      eval: vi.fn().mockResolvedValue([2, 45_000]),
      isOpen: true,
    };
    const limiter = new RedisAuthRateLimiter(client, "test-hash-secret");

    await expect(limiter.consume(rule)).resolves.toEqual({
      allowed: true,
      remaining: 1,
      retryAfterMs: 45_000,
    });
    const call = client.eval.mock.calls[0];
    expect(JSON.stringify(call)).not.toContain("LINXIA@example.com");
    expect(JSON.stringify(call)).toContain("notion-editor:auth-rate:login:");
  });

  it("clears the hashed counter after a successful authentication", async () => {
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      del: vi.fn().mockResolvedValue(1),
      eval: vi.fn(),
      isOpen: true,
    };
    const limiter = new RedisAuthRateLimiter(client, "test-hash-secret");

    await limiter.reset(rule);

    expect(client.del).toHaveBeenCalledOnce();
    expect(client.del.mock.calls[0][0]).toContain("notion-editor:auth-rate:login:");
    expect(client.del.mock.calls[0][0]).not.toContain("LINXIA@example.com");
  });
});

describe("InMemoryAuthRateLimiter", () => {
  it("blocks requests over the limit and resets after the window", async () => {
    let now = 1000;
    const limiter = new InMemoryAuthRateLimiter("test-hash-secret", () => now);

    await expect(limiter.consume(rule)).resolves.toMatchObject({ allowed: true, remaining: 2 });
    await limiter.consume(rule);
    await limiter.consume(rule);
    await expect(limiter.consume(rule)).resolves.toMatchObject({ allowed: false, remaining: 0 });

    now += rule.windowMs + 1;
    await expect(limiter.consume(rule)).resolves.toMatchObject({ allowed: true, remaining: 2 });
  });

  it("clears the active counter after a successful authentication", async () => {
    const limiter = new InMemoryAuthRateLimiter("test-hash-secret");
    await limiter.consume(rule);
    await limiter.consume(rule);
    await limiter.consume(rule);
    await expect(limiter.consume(rule)).resolves.toMatchObject({ allowed: false });

    await limiter.reset(rule);

    await expect(limiter.consume(rule)).resolves.toMatchObject({ allowed: true, remaining: 2 });
  });
});

describe("createAuthRateLimiter", () => {
  it("fails closed in production without Redis", async () => {
    const limiter = createAuthRateLimiter({
      hashSecret: "production-secret",
      production: true,
      redisUrl: undefined,
    });

    await expect(limiter.consume(rule)).rejects.toBeInstanceOf(AuthRateLimitUnavailableError);
  });

  it("uses an in-memory fallback in development", async () => {
    const limiter = createAuthRateLimiter({
      hashSecret: "development-secret",
      production: false,
      redisUrl: undefined,
    });

    await expect(limiter.consume(rule)).resolves.toMatchObject({ allowed: true });
  });
});
