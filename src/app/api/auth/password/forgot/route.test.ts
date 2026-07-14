import { describe, expect, it, vi } from "vitest";
import { AuthCodeCooldownError } from "../../../../../server/postgresAuthStore";
import { createForgotPasswordRouteHandler } from "./handlers";

describe("forgot password route", () => {
  it("returns explicit responses for existing, missing, and cooling-down emails", async () => {
    const user = { displayName: "林夏", email: "linxia@example.com", id: "user-1" };
    const authStore = {
      createPasswordReset: vi.fn()
        .mockResolvedValueOnce({ code: "123456", user })
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new AuthCodeCooldownError(42)),
    };
    const mailer = { sendPasswordResetCode: vi.fn().mockResolvedValue(undefined) };
    const security = {
      audit: vi.fn().mockResolvedValue(undefined),
      check: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 1, unavailable: false }),
      reset: vi.fn().mockResolvedValue(undefined),
    };
    const handler = createForgotPasswordRouteHandler({ authStore, mailer, security });

    const existing = await handler(jsonRequest({ email: "linxia@example.com" }));
    const missing = await handler(jsonRequest({ email: "missing@example.com" }));
    const coolingDown = await handler(jsonRequest({ email: "linxia@example.com" }));

    expect(existing.status).toBe(202);
    expect(missing.status).toBe(404);
    expect(coolingDown.status).toBe(429);
    await expect(existing.json()).resolves.toEqual({ accepted: true, retryAfterSeconds: 60 });
    await expect(missing.json()).resolves.toEqual({ error: "该邮箱尚未注册，请先创建账号" });
    expect(coolingDown.headers.get("retry-after")).toBe("42");
    await expect(coolingDown.json()).resolves.toEqual({
      codeAvailable: true,
      error: "请在 42 秒后重新发送验证码",
      retryAfterSeconds: 42,
    });
    expect(mailer.sendPasswordResetCode).toHaveBeenCalledWith(user, "123456");
    expect(mailer.sendPasswordResetCode).toHaveBeenCalledTimes(1);
  });

  it("reports password-reset mail delivery failures without exposing internals", async () => {
    const user = { displayName: "林夏", email: "linxia@example.com", id: "user-1" };
    const authStore = {
      createPasswordReset: vi.fn().mockResolvedValue({ code: "123456", user }),
    };
    const transportError = "connect ECONNREFUSED smtp.qq.com:465";
    const mailer = { sendPasswordResetCode: vi.fn().mockRejectedValue(new Error(transportError)) };
    const security = {
      audit: vi.fn().mockResolvedValue(undefined),
      check: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 1, unavailable: false }),
      reset: vi.fn().mockResolvedValue(undefined),
    };

    const response = await createForgotPasswordRouteHandler({
      authStore,
      mailer,
      security,
    })(jsonRequest({ email: user.email }));

    expect(response.status).toBe(503);
    expect(mailer.sendPasswordResetCode).toHaveBeenCalledWith(user, "123456");
    const payload = await response.json();
    expect(payload).toEqual({ error: "密码重置邮件发送失败，请检查邮箱地址或稍后重试" });
    expect(JSON.stringify(payload)).not.toContain(transportError);
  });
});

function jsonRequest(payload: unknown) {
  return new Request("http://localhost/api/auth/password/forgot", {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}
