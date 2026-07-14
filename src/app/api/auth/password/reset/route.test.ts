import { describe, expect, it, vi } from "vitest";
import { AuthDomainError } from "../../../../../server/authErrors";
import { createResetPasswordRouteHandler } from "./handlers";

describe("reset password route", () => {
  it("resets the password and issues the replacement session cookie", async () => {
    const authStore = {
      resetPassword: vi.fn().mockResolvedValue({
        expiresAt: 5000,
        token: "replacement-session-token",
        user: { displayName: "林夏", email: "linxia@example.com", id: "user-1" },
      }),
    };
    const security = createSecurity();
    const response = await createResetPasswordRouteHandler(authStore, security)(jsonRequest({
      code: "123456",
      email: "linxia@example.com",
      password: "replacement secure password",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      reset: true,
      user: { displayName: "林夏", email: "linxia@example.com", id: "user-1" },
    });
    expect(response.headers.get("set-cookie")).toContain("notion_editor_session=replacement-session-token");
    expect(security.reset).toHaveBeenCalledWith(
      expect.any(Request),
      "reset-password",
      "linxia@example.com",
    );
  });

  it("explains expired reset codes", async () => {
    const authStore = {
      resetPassword: vi.fn().mockRejectedValue(new AuthDomainError("reset_code_expired")),
    };
    const response = await createResetPasswordRouteHandler(authStore, createSecurity())(jsonRequest({
      code: "123456",
      email: "linxia@example.com",
      password: "replacement secure password",
    }));

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: "密码重置验证码已过期，请重新发送" });
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
  return new Request("http://localhost/api/auth/password/reset", {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}
