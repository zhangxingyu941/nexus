import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AuthMailer, createAuthMailerFromEnvironment } from "./authMailer";

const user = {
  displayName: "林夏",
  email: "linxia@example.com",
  id: "user-1",
};

describe("AuthMailer", () => {
  it("does not log a development verification code when SMTP is absent", async () => {
    const logger = { info: vi.fn() };
    const mailer = new AuthMailer({
      from: "Nexus <noreply@example.com>",
      logger,
      production: false,
    });

    await mailer.sendEmailVerificationCode(user, "123456");

    expect(logger.info).toHaveBeenCalledWith("开发环境未配置 SMTP，验证码未发送");
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("123456");
  });

  it("requires SMTP delivery in production", async () => {
    const mailer = new AuthMailer({
      from: "Nexus <noreply@example.com>",
      logger: { info: vi.fn() },
      production: true,
    });

    await expect(mailer.sendPasswordResetCode(user, "123456")).rejects.toThrow("SMTP 未配置");
  });

  it("sends password reset mail through the configured transport", async () => {
    const transport = { sendMail: vi.fn().mockResolvedValue({ messageId: "mail-1" }) };
    const mailer = new AuthMailer({
      from: "Nexus <noreply@example.com>",
      logger: { info: vi.fn() },
      production: true,
      transport,
    });

    await mailer.sendPasswordResetCode(user, "123456");

    expect(transport.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "Nexus <noreply@example.com>",
      html: expect.stringContaining("123456"),
      subject: "重置 Nexus 密码",
      text: expect.stringContaining("123456"),
      to: "linxia@example.com",
    }));
    expect(JSON.stringify(transport.sendMail.mock.calls)).not.toContain("/auth/reset");
  });

  it("sends an escaped gray-and-white HTML verification email without remote resources", async () => {
    const transport = { sendMail: vi.fn().mockResolvedValue({ messageId: "mail-2" }) };
    const mailer = new AuthMailer({
      from: "Nexus <noreply@example.com>",
      logger: { info: vi.fn() },
      production: true,
      transport,
    });

    await mailer.sendEmailVerificationCode({
      ...user,
      displayName: '林夏 <script>alert("x")</script>',
    }, "123456");

    const message = transport.sendMail.mock.calls[0][0];
    const html = String(message.html);
    expect(message.text).toContain("123456");
    expect(html).toContain("123456");
    expect(html).toContain("10 分钟内有效");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/<img|https?:\/\//i);
    expect(html).not.toContain("/auth/verify");
    expect(html).toContain("#f4f4f5");
    expect(html).toContain("#e4e4e7");
  });

  it("captures codes to an explicit JSONL file before attempting SMTP", async () => {
    const directory = await mkdtemp(join(tmpdir(), "auth-mail-capture-"));
    const captureFile = join(directory, "mail.jsonl");
    vi.stubEnv("AUTH_MAIL_CAPTURE_FILE", captureFile);
    vi.stubEnv("NODE_ENV", "production");

    try {
      const mailer = createAuthMailerFromEnvironment();
      await mailer.sendEmailVerificationCode(user, "123456");
      const captures = (await readFile(captureFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line));

      expect(captures).toEqual([expect.objectContaining({
        code: "123456",
        purpose: "verify-email",
        subject: "验证 Nexus 邮箱",
        to: "linxia@example.com",
      })]);
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
