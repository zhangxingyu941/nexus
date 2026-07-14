import { describe, expect, it, vi } from "vitest";
import { AuthDomainError } from "../../../../server/authErrors";
import { createVerifyEmailRouteHandler } from "./handlers";

describe("verify email route", () => {
  it("consumes a verification code and issues a session", async () => {
    const user = { displayName: "林夏", email: "linxia@example.com", id: "user-1" };
    const authStore = {
      verifyEmail: vi.fn().mockResolvedValue({
        expiresAt: 5000,
        token: "verified-session-token",
        user,
      }),
    };
    const security = createSecurity();
    const response = await createVerifyEmailRouteHandler(authStore, security)(
      jsonRequest({ code: "123456", email: "linxia@example.com" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ user, verified: true });
    expect(response.headers.get("set-cookie")).toContain("notion_editor_session=verified-session-token");
    expect(authStore.verifyEmail).toHaveBeenCalledWith({ code: "123456", email: "linxia@example.com" });
    expect(security.check).toHaveBeenCalledWith(expect.any(Request), "verify-email", "linxia@example.com");
  });

  it("explains expired verification codes", async () => {
    const authStore = {
      verifyEmail: vi.fn().mockRejectedValue(new AuthDomainError("verify_code_expired")),
    };
    const response = await createVerifyEmailRouteHandler(authStore, createSecurity())(
      jsonRequest({ code: "123456", email: "linxia@example.com" }),
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: "邮箱验证码已过期，请重新发送" });
  });
});

function createSecurity() {
  return {
    audit: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 1, unavailable: false }),
    reset: vi.fn().mockResolvedValue(undefined),
  };
}

function jsonRequest(payload: unknown) {
  return new Request("http://localhost/api/auth/verify-email", {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}
