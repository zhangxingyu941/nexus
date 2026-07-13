import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import nodemailer from "nodemailer";
import type { SendMailOptions } from "nodemailer";
import type { AppUser } from "./postgresAuthStore";

interface AuthMailTransport {
  sendMail(options: SendMailOptions): Promise<unknown>;
}

interface AuthMailLogger {
  info(message: string): void;
}

interface AuthMailCapture {
  write(input: { code: string; purpose: "reset-password" | "verify-email"; subject: string; to: string }): Promise<void>;
}

interface AuthMailerOptions {
  capture?: AuthMailCapture;
  from: string;
  logger: AuthMailLogger;
  production: boolean;
  transport?: AuthMailTransport;
}

export class AuthMailer {
  constructor(private readonly options: AuthMailerOptions) {}

  async sendEmailVerificationCode(user: AppUser, code: string) {
    await this.deliver({
      code,
      html: createAuthEmailHtml({
        code,
        displayName: user.displayName,
        purpose: "verify-email",
      }),
      purpose: "verify-email",
      subject: "验证 Nexus 邮箱",
      text: `${user.displayName}，你的 Nexus 注册验证码是：${code}\n\n验证码 10 分钟内有效，请勿转发给他人。`,
      to: user.email,
    });
  }

  async sendPasswordResetCode(user: AppUser, code: string) {
    await this.deliver({
      code,
      html: createAuthEmailHtml({
        code,
        displayName: user.displayName,
        purpose: "reset-password",
      }),
      purpose: "reset-password",
      subject: "重置 Nexus 密码",
      text: `${user.displayName}，你的 Nexus 密码重置验证码是：${code}\n\n验证码 10 分钟内有效。如果不是你本人操作，请忽略本邮件。`,
      to: user.email,
    });
  }

  private async deliver(input: {
    code: string;
    html: string;
    purpose: "reset-password" | "verify-email";
    subject: string;
    text: string;
    to: string;
  }) {
    if (this.options.capture) {
      await this.options.capture.write({
        code: input.code,
        purpose: input.purpose,
        subject: input.subject,
        to: input.to,
      });
      return;
    }

    if (this.options.transport) {
      await this.options.transport.sendMail({
        from: this.options.from,
        html: input.html,
        subject: input.subject,
        text: input.text,
        to: input.to,
      });
      return;
    }

    if (this.options.production) {
      throw new Error("SMTP 未配置");
    }

    this.options.logger.info("开发环境未配置 SMTP，验证码未发送");
  }
}

function createAuthEmailHtml({
  code,
  displayName,
  purpose,
}: {
  code: string;
  displayName: string;
  purpose: "reset-password" | "verify-email";
}) {
  const escapedCode = escapeHtml(code);
  const escapedDisplayName = escapeHtml(displayName);
  const isVerification = purpose === "verify-email";
  const heading = isVerification ? "完成邮箱验证" : "重置账号密码";
  const description = isVerification
    ? "使用下面的验证码完成 Nexus 账号注册。"
    : "使用下面的验证码重置你的 Nexus 账号密码。";
  const securityNotice = isVerification
    ? "如果不是你本人注册，请忽略这封邮件。"
    : "如果不是你本人发起密码重置，请立即检查账号安全。";

  return `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:0;background-color:#f4f4f5;color:#18181b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f4f4f5;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:8px;">
            <tr>
              <td style="padding:28px 28px 12px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="width:36px;height:36px;border-radius:6px;background-color:#18181b;color:#ffffff;text-align:center;font-size:16px;font-weight:700;line-height:36px;">N</td>
                    <td style="padding-left:10px;font-size:15px;font-weight:700;color:#18181b;">Nexus</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 28px 32px;">
                <p style="margin:0 0 8px;font-size:14px;line-height:22px;color:#71717a;">你好，${escapedDisplayName}</p>
                <h1 style="margin:0 0 12px;font-size:24px;line-height:32px;font-weight:700;color:#18181b;">${heading}</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:24px;color:#52525b;">${description}</p>
                <div style="padding:20px 16px;border:1px solid #e4e4e7;border-radius:6px;background-color:#f4f4f5;text-align:center;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:32px;line-height:40px;font-weight:700;color:#18181b;">${escapedCode}</div>
                <p style="margin:16px 0 0;font-size:14px;line-height:22px;font-weight:600;color:#3f3f46;text-align:center;">验证码 10 分钟内有效</p>
                <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e4e4e7;">
                  <p style="margin:0;font-size:13px;line-height:21px;color:#71717a;">${securityNotice} 请勿向任何人提供此验证码。</p>
                </div>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:12px;line-height:18px;color:#a1a1aa;">此邮件由 Nexus 自动发送，请勿回复。</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character]);
}

export function createAuthMailerFromEnvironment() {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  const transport = host
    ? nodemailer.createTransport({
        auth: user && password ? { pass: password, user } : undefined,
        host,
        port: parseSmtpPort(process.env.SMTP_PORT),
        secure: process.env.SMTP_SECURE === "true",
      }) as AuthMailTransport
    : undefined;
  const captureFile = process.env.AUTH_MAIL_CAPTURE_FILE?.trim();

  return new AuthMailer({
    capture: captureFile ? new JsonlAuthMailCapture(captureFile) : undefined,
    from: process.env.SMTP_FROM?.trim() || "Nexus <noreply@localhost>",
    logger: console,
    production: process.env.NODE_ENV === "production",
    transport,
  });
}

class JsonlAuthMailCapture implements AuthMailCapture {
  constructor(private readonly filePath: string) {}

  async write(input: { code: string; purpose: "reset-password" | "verify-email"; subject: string; to: string }) {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(
      this.filePath,
      `${JSON.stringify({ ...input, createdAt: Date.now() })}\n`,
      "utf8",
    );
  }
}

function parseSmtpPort(value: string | undefined) {
  const port = Number(value ?? "587");
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("SMTP_PORT 必须是有效端口");
  }
  return port;
}
