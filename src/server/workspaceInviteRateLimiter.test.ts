import { describe, expect, it, vi } from "vitest";
import {
  InMemoryWorkspaceInviteRateLimiter,
  RedisWorkspaceInviteRateLimiter,
  WorkspaceInviteRateLimitUnavailableError,
  createWorkspaceInviteRateLimiter,
} from "./workspaceInviteRateLimiter";

describe("InMemoryWorkspaceInviteRateLimiter", () => {
  it("limits workspace and recipient attempts independently", async () => {
    const limiter = new InMemoryWorkspaceInviteRateLimiter(() => 1_000);

    for (let index = 0; index < 5; index += 1) {
      await expect(limiter.consume("workspace-1", "member@example.com"))
        .resolves.toMatchObject({ allowed: true });
    }

    await expect(limiter.consume("workspace-1", "member@example.com"))
      .resolves.toMatchObject({ allowed: false, scope: "email" });
    await expect(limiter.consume("workspace-2", "member@example.com"))
      .resolves.toMatchObject({ allowed: false, scope: "email" });
  });

  it("limits all recipients once a workspace reaches twenty hourly attempts", async () => {
    const limiter = new InMemoryWorkspaceInviteRateLimiter(() => 1_000);

    for (let index = 0; index < 20; index += 1) {
      await expect(limiter.consume("workspace-1", `member-${index}@example.com`))
        .resolves.toMatchObject({ allowed: true });
    }

    await expect(limiter.consume("workspace-1", "member-20@example.com"))
      .resolves.toMatchObject({ allowed: false, scope: "workspace" });
  });

  it("starts a fresh fixed window after one hour", async () => {
    let now = 1_000;
    const limiter = new InMemoryWorkspaceInviteRateLimiter(() => now);

    for (let index = 0; index < 5; index += 1) {
      await limiter.consume("workspace-1", "member@example.com");
    }
    await expect(limiter.consume("workspace-1", "member@example.com"))
      .resolves.toMatchObject({ allowed: false, scope: "email", retryAfterMs: 3_600_000 });

    now += 3_600_001;
    await expect(limiter.consume("workspace-1", "member@example.com"))
      .resolves.toMatchObject({ allowed: true, retryAfterMs: 3_600_000 });
  });
});

describe("RedisWorkspaceInviteRateLimiter", () => {
  it("uses one Lua counter operation without exposing the recipient email", async () => {
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      eval: vi.fn().mockResolvedValue([4, 3_500_000, 6, 3_400_000]),
      isOpen: true,
    };
    const limiter = new RedisWorkspaceInviteRateLimiter(client, "test-hash-secret");

    await expect(limiter.consume("workspace-1", "MEMBER@example.com"))
      .resolves.toEqual({
        allowed: false,
        retryAfterMs: 3_400_000,
        scope: "email",
      });

    const [script, options] = client.eval.mock.calls[0];
    expect(script).toContain("INCR");
    expect(options.keys).toHaveLength(2);
    expect(JSON.stringify(options)).not.toContain("MEMBER@example.com");
    expect(JSON.stringify(options)).not.toContain("workspace-1");
  });

  it("converts Redis failures into a stable availability error", async () => {
    const limiter = new RedisWorkspaceInviteRateLimiter({
      connect: vi.fn().mockResolvedValue(undefined),
      eval: vi.fn().mockRejectedValue(new Error("redis details")),
      isOpen: true,
    }, "test-hash-secret");

    await expect(limiter.consume("workspace-1", "member@example.com"))
      .rejects.toBeInstanceOf(WorkspaceInviteRateLimitUnavailableError);
  });
});

describe("createWorkspaceInviteRateLimiter", () => {
  it("fails closed in production without Redis and uses memory in development", async () => {
    const production = createWorkspaceInviteRateLimiter({
      hashSecret: "test-hash-secret",
      production: true,
      redisUrl: undefined,
    });
    const development = createWorkspaceInviteRateLimiter({
      hashSecret: "test-hash-secret",
      production: false,
      redisUrl: undefined,
    });

    await expect(production.consume("workspace-1", "member@example.com"))
      .rejects.toBeInstanceOf(WorkspaceInviteRateLimitUnavailableError);
    await expect(development.consume("workspace-1", "member@example.com"))
      .resolves.toMatchObject({ allowed: true });
  });
});
