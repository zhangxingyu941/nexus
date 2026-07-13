import { describe, expect, it, vi } from "vitest";
import { AuthCodeCooldownError } from "../../../../../server/postgresAuthStore";
import { createForgotPasswordRouteHandler } from "./handlers";

describe("forgot password route", () => {
  it("returns the same response for existing and missing emails", async () => {
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
    expect(missing.status).toBe(202);
    expect(coolingDown.status).toBe(202);
    await expect(existing.json()).resolves.toEqual({ accepted: true, retryAfterSeconds: 60 });
    await expect(missing.json()).resolves.toEqual({ accepted: true, retryAfterSeconds: 60 });
    await expect(coolingDown.json()).resolves.toEqual({ accepted: true, retryAfterSeconds: 60 });
    expect(mailer.sendPasswordResetCode).toHaveBeenCalledWith(user, "123456");
    expect(mailer.sendPasswordResetCode).toHaveBeenCalledTimes(1);
  });
});

function jsonRequest(payload: unknown) {
  return new Request("http://localhost/api/auth/password/forgot", {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}
