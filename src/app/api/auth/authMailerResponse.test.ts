import { expect, it } from "vitest";
import { resolveAuthMailer } from "./authMailerResponse";

it("returns a stable service error when mail configuration cannot be loaded", async () => {
  const internalError = "SMTP_PORT 必须是 1 到 65535 的整数";
  const result = resolveAuthMailer(() => {
    throw new Error(internalError);
  });

  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("expected mailer resolution to fail");
  }
  expect(result.response.status).toBe(503);
  const payload = await result.response.json();
  expect(payload).toEqual({ error: "邮件服务配置无效，请联系管理员检查 SMTP 配置" });
  expect(JSON.stringify(payload)).not.toContain(internalError);
});
