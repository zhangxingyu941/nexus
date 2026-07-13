import { describe, expect, it, vi } from "vitest";
import { AuthRequestSecurity } from "./authRequestSecurity";

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
});
