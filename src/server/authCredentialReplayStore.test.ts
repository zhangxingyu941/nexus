import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AuthCredentialServiceUnavailableError,
  InMemoryAuthCredentialReplayStore,
  RedisAuthCredentialReplayStore,
  createAuthCredentialReplayStore,
} from "./authCredentialReplayStore";

const HASH_SECRET = "test-replay-hash-secret-at-least-32-bytes";

describe("InMemoryAuthCredentialReplayStore", () => {
  it("accepts an unexpired jti once and permits reuse after its entry expires", async () => {
    let now = 1_000;
    const store = new InMemoryAuthCredentialReplayStore(() => now);

    await expect(store.consume("challenge-jti", 2_000)).resolves.toBe(true);
    await expect(store.consume("challenge-jti", 2_000)).resolves.toBe(false);

    now = 2_001;
    await expect(store.consume("challenge-jti", 3_000)).resolves.toBe(true);
  });

  it("rejects an already expired jti at the exact time boundary without storing it", async () => {
    const store = new InMemoryAuthCredentialReplayStore(() => 2_000);

    await expect(store.consume("boundary-jti", 2_000)).resolves.toBe(false);
    await expect(store.consume("boundary-jti", 3_000)).resolves.toBe(true);
  });

  it("allows exactly one concurrent consume for the same unexpired jti", async () => {
    const store = new InMemoryAuthCredentialReplayStore(() => 1_000);

    const results = await Promise.all([
      store.consume("concurrent-jti", 2_000),
      store.consume("concurrent-jti", 2_000),
      store.consume("concurrent-jti", 2_000),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("RedisAuthCredentialReplayStore", () => {
  it("uses a hidden HMAC key and atomically sets NX with the remaining TTL", async () => {
    let isOpen = false;
    const client = {
      connect: vi.fn(async () => {
        isOpen = true;
      }),
      get isOpen() {
        return isOpen;
      },
      set: vi.fn()
        .mockResolvedValueOnce("OK")
        .mockResolvedValueOnce(null),
    };
    const store = new RedisAuthCredentialReplayStore(
      client,
      HASH_SECRET,
      () => 1_000,
    );

    await expect(store.consume("raw-challenge-jti", 61_000)).resolves.toBe(true);
    await expect(store.consume("raw-challenge-jti", 61_000)).resolves.toBe(false);

    const expectedHash = createHmac("sha256", HASH_SECRET)
      .update("raw-challenge-jti")
      .digest("hex");
    expect(client.connect).toHaveBeenCalledOnce();
    expect(client.set).toHaveBeenNthCalledWith(
      1,
      `notion-editor:auth-credential:${expectedHash}`,
      "1",
      { NX: true, PX: 60_000 },
    );
    expect(JSON.stringify(client.set.mock.calls)).not.toContain("raw-challenge-jti");
  });

  it("rejects expiry at the current time without connecting or setting a key", async () => {
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      isOpen: false,
      set: vi.fn().mockResolvedValue("OK"),
    };
    const store = new RedisAuthCredentialReplayStore(
      client,
      HASH_SECRET,
      () => 1_000,
    );

    await expect(store.consume("boundary-jti", 1_000)).resolves.toBe(false);
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
  });

  it("converts Redis failures into the stable unavailable error", async () => {
    const client = {
      connect: vi.fn(),
      isOpen: true,
      set: vi.fn().mockRejectedValue(new Error("redis connection details")),
    };
    const store = new RedisAuthCredentialReplayStore(client, HASH_SECRET);

    await expect(store.consume("challenge-jti", Date.now() + 60_000))
      .rejects.toBeInstanceOf(AuthCredentialServiceUnavailableError);
  });
});

describe("createAuthCredentialReplayStore", () => {
  it("rejects an AUTH_HASH_SECRET shorter than 32 UTF-8 bytes", () => {
    expect(() => createAuthCredentialReplayStore({
      hashSecret: "x".repeat(31),
      production: false,
      redisUrl: undefined,
    })).toThrowError(AuthCredentialServiceUnavailableError);
  });

  it("fails closed in production when Redis is not configured", async () => {
    const store = createAuthCredentialReplayStore({
      hashSecret: HASH_SECRET,
      production: true,
      redisUrl: undefined,
    });

    await expect(store.consume("challenge-jti", Date.now() + 60_000))
      .rejects.toBeInstanceOf(AuthCredentialServiceUnavailableError);
  });

  it("uses memory in development when Redis is not configured", async () => {
    const store = createAuthCredentialReplayStore({
      hashSecret: HASH_SECRET,
      production: false,
      redisUrl: undefined,
    });

    await expect(store.consume("challenge-jti", Date.now() + 60_000)).resolves.toBe(true);
    await expect(store.consume("challenge-jti", Date.now() + 60_000)).resolves.toBe(false);
  });

  it("falls back to memory in development when Redis fails", async () => {
    const client = {
      connect: vi.fn(),
      isOpen: true,
      on: vi.fn(),
      set: vi.fn().mockRejectedValue(new Error("redis unavailable")),
    };
    const store = createAuthCredentialReplayStore({
      hashSecret: HASH_SECRET,
      production: false,
      redisClient: client,
      redisUrl: "redis://localhost:6379",
    });

    await expect(store.consume("challenge-jti", Date.now() + 60_000)).resolves.toBe(true);
    await expect(store.consume("challenge-jti", Date.now() + 60_000)).resolves.toBe(false);
    expect(client.on).toHaveBeenCalledWith("error", expect.any(Function));
  });
});
