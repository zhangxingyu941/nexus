import { describe, expect, it, vi } from "vitest";
import { AuthRequestSecurity, getAuthRequestSecurity } from "./authRequestSecurity";

describe("AuthRequestSecurity", () => {
  it("checks both identity and IP limits with bounded rules", async () => {
    const limiter = {
      consume: vi.fn()
        .mockResolvedValueOnce({ allowed: true, remaining: 4, retryAfterMs: 60_000 })
        .mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterMs: 45_000 }),
      reset: vi.fn(),
    };
    const security = new AuthRequestSecurity({
      auditStore: { recordAuditEvent: vi.fn() },
      hashSecret: "test-hash-secret",
      limiter,
      trustedProxy: true,
    });
    const request = new Request("http://localhost/api/auth/session", {
      headers: { "X-Forwarded-For": "203.0.113.10, 10.0.0.1" },
    });

    await expect(security.check(request, "login", "linxia@example.com")).resolves.toEqual({
      allowed: false,
      retryAfterSeconds: 45,
      unavailable: false,
    });
    expect(limiter.consume).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: "login:identity",
      identifier: "linxia@example.com",
    }));
    expect(limiter.consume).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: "login:ip",
      identifier: "203.0.113.10",
    }));
  });

  it("records only a hashed IP in authentication audit events", async () => {
    const auditStore = { recordAuditEvent: vi.fn().mockResolvedValue(undefined) };
    const security = new AuthRequestSecurity({
      auditStore,
      hashSecret: "test-hash-secret",
      limiter: { consume: vi.fn(), reset: vi.fn() },
    });
    const request = new Request("http://localhost", {
      headers: { "X-Real-IP": "203.0.113.10" },
    });

    await security.audit(request, "password-login", false, null);

    const event = auditStore.recordAuditEvent.mock.calls[0][0];
    expect(event.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(event)).not.toContain("203.0.113.10");
  });

  it("resets both identity and IP counters after successful authentication", async () => {
    const limiter = {
      consume: vi.fn(),
      reset: vi.fn().mockResolvedValue(undefined),
    };
    const security = new AuthRequestSecurity({
      auditStore: { recordAuditEvent: vi.fn() },
      hashSecret: "test-hash-secret",
      limiter,
      trustedProxy: true,
    });
    const request = new Request("http://localhost/api/auth/session", {
      headers: { "X-Forwarded-For": "203.0.113.10, 10.0.0.1" },
    });

    await security.reset(request, "login", "linxia@example.com");

    expect(limiter.reset).toHaveBeenNthCalledWith(1, {
      action: "login:identity",
      identifier: "linxia@example.com",
    });
    expect(limiter.reset).toHaveBeenNthCalledWith(2, {
      action: "login:ip",
      identifier: "203.0.113.10",
    });
  });

  it("checks only the IP limit for an empty credential challenge identifier", async () => {
    const limiter = {
      consume: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 29,
        retryAfterMs: 60_000,
      }),
      reset: vi.fn(),
    };
    const security = new AuthRequestSecurity({
      auditStore: { recordAuditEvent: vi.fn() },
      hashSecret: "test-hash-secret",
      limiter,
      trustedProxy: true,
    });
    const request = new Request("http://localhost/api/auth/credential-challenge", {
      headers: { "X-Forwarded-For": "203.0.113.20" },
    });

    await expect(security.check(request, "credential-challenge", "")).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 60,
      unavailable: false,
    });
    expect(limiter.consume).toHaveBeenCalledOnce();
    expect(limiter.consume).toHaveBeenCalledWith({
      action: "credential-challenge:ip",
      identifier: "203.0.113.20",
      limit: 30,
      windowMs: 60_000,
    });
  });

  it("resets only the IP limit for an empty identifier", async () => {
    const limiter = {
      consume: vi.fn(),
      reset: vi.fn().mockResolvedValue(undefined),
    };
    const security = new AuthRequestSecurity({
      auditStore: { recordAuditEvent: vi.fn() },
      hashSecret: "test-hash-secret",
      limiter,
      trustedProxy: true,
    });
    const request = new Request("http://localhost/api/auth/credential-challenge", {
      headers: { "X-Real-IP": "203.0.113.20" },
    });

    await security.reset(request, "credential-challenge", "");

    expect(limiter.reset).toHaveBeenCalledOnce();
    expect(limiter.reset).toHaveBeenCalledWith({
      action: "credential-challenge:ip",
      identifier: "203.0.113.20",
    });
  });

  it("ignores spoofed forwarding headers when proxy trust is disabled", async () => {
    const limiter = {
      consume: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 4,
        retryAfterMs: 60_000,
      }),
      reset: vi.fn(),
    };
    const security = new AuthRequestSecurity({
      auditStore: { recordAuditEvent: vi.fn() },
      hashSecret: "test-hash-secret",
      limiter,
    });
    const request = new Request("http://localhost/api/auth/session", {
      headers: {
        "X-Forwarded-For": "203.0.113.99",
        "X-Real-IP": "203.0.113.98",
      },
    });

    await security.check(request, "login", "linxia@example.com");

    expect(limiter.consume).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: "login:ip",
      identifier: "unknown",
    }));
  });

  it("includes AUTH_TRUST_PROXY in shared security configuration", async () => {
    const environmentKeys = [
      "AUTH_HASH_SECRET",
      "AUTH_TRUST_PROXY",
      "NODE_ENV",
      "REDIS_URL",
    ] as const;
    const originalEnvironment = Object.fromEntries(
      environmentKeys.map((key) => [key, process.env[key]]),
    );
    const auditStore = { recordAuditEvent: vi.fn().mockResolvedValue(undefined) };
    const request = new Request("http://localhost", {
      headers: { "X-Forwarded-For": "203.0.113.77" },
    });

    try {
      process.env.AUTH_HASH_SECRET = "proxy-test-hash-secret-at-least-32-bytes";
      process.env.AUTH_TRUST_PROXY = "false";
      Reflect.set(process.env, "NODE_ENV", "test");
      delete process.env.REDIS_URL;
      const untrusted = getAuthRequestSecurity(auditStore);
      await untrusted.audit(request, "proxy-untrusted", true, null);

      process.env.AUTH_TRUST_PROXY = "true";
      const trusted = getAuthRequestSecurity(auditStore);
      await trusted.audit(request, "proxy-trusted", true, null);

      expect(trusted).not.toBe(untrusted);
      expect(auditStore.recordAuditEvent.mock.calls[0][0].ipHash)
        .not.toBe(auditStore.recordAuditEvent.mock.calls[1][0].ipHash);
    } finally {
      for (const key of environmentKeys) {
        const value = originalEnvironment[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          Reflect.set(process.env, key, value);
        }
      }
    }
  });
});
