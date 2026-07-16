import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import nodemailer from "nodemailer";
import type { SendMailOptions } from "nodemailer";
import type { WorkspaceInviteRole } from "../shared/workspaceInvites";

interface WorkspaceInviteMailTransport {
  sendMail(options: SendMailOptions): Promise<unknown>;
}

interface WorkspaceInviteMailLogger {
  info(message: string): void;
}

interface WorkspaceInviteMailCapture {
  write(input: WorkspaceInviteMailInput & { subject: string }): Promise<void>;
}

export interface WorkspaceInviteMailInput {
  email: string;
  inviterDisplayName: string;
  role: WorkspaceInviteRole;
  url: string;
  workspaceName: string;
}

interface WorkspaceInviteMailerOptions {
  capture?: WorkspaceInviteMailCapture;
  from: string;
  logger: WorkspaceInviteMailLogger;
  production: boolean;
  transport?: WorkspaceInviteMailTransport;
}

export class WorkspaceInviteMailer {
  constructor(private readonly options: WorkspaceInviteMailerOptions) {}

  async send(input: WorkspaceInviteMailInput) {
    const subject = `${input.inviterDisplayName}邀请你加入${input.workspaceName}`;
    if (this.options.capture) {
      await this.options.capture.write({ ...input, subject });
      return;
    }

    if (this.options.transport) {
      await this.options.transport.sendMail({
        from: this.options.from,
        html: createInvitationHtml(input),
        subject,
        text: createInvitationText(input),
        to: input.email,
      });
      return;
    }

    if (this.options.production) {
      throw new Error("SMTP 未配置");
    }

    this.options.logger.info("开发环境未配置 SMTP，工作区邀请邮件未发送");
  }
}

export function createWorkspaceInviteMailerFromEnvironment() {
  const production = process.env.NODE_ENV === "production";
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;
  const transport = host
    ? nodemailer.createTransport({
        auth: user && password ? { pass: password, user } : undefined,
        host,
        port: parseSmtpPort(process.env.SMTP_PORT),
        secure: process.env.SMTP_SECURE === "true",
      }) as WorkspaceInviteMailTransport
    : undefined;
  const captureFile = process.env.AUTH_MAIL_CAPTURE_FILE?.trim();
  if (
    captureFile
    && production
    && process.env.AUTH_MAIL_CAPTURE_ALLOW_PRODUCTION !== "true"
  ) {
    throw new Error("生产环境邮件捕获未显式授权");
  }

  return new WorkspaceInviteMailer({
    capture: captureFile ? new JsonlWorkspaceInviteMailCapture(captureFile) : undefined,
    from: process.env.SMTP_FROM?.trim() || "Nexus <noreply@localhost>",
    logger: console,
    production,
    transport,
  });
}

class JsonlWorkspaceInviteMailCapture implements WorkspaceInviteMailCapture {
  constructor(private readonly filePath: string) {}

  async write(input: WorkspaceInviteMailInput & { subject: string }) {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(
      this.filePath,
      `${JSON.stringify({
        createdAt: Date.now(),
        purpose: "workspace-invite",
        subject: input.subject,
        to: input.email,
        url: input.url,
      })}\n`,
      "utf8",
    );
  }
}

function createInvitationText(input: WorkspaceInviteMailInput) {
  const role = input.role === "editor" ? "编辑者" : "查看者";
  return `${input.inviterDisplayName}邀请你以${role}身份加入 Nexus 工作区“${input.workspaceName}”。\n\n${input.url}\n\n此邀请将在 24 小时后失效，请勿转发给他人。`;
}

function createInvitationHtml(input: WorkspaceInviteMailInput) {
  const inviter = escapeHtml(input.inviterDisplayName);
  const role = input.role === "editor" ? "编辑者" : "查看者";
  const url = escapeHtml(input.url);
  const workspaceName = escapeHtml(input.workspaceName);

  return `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:0;background-color:#f4f4f5;color:#18181b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background-color:#f4f4f5;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:8px;">
            <tr><td style="padding:28px 28px 12px;font-size:15px;font-weight:700;color:#18181b;">Nexus</td></tr>
            <tr>
              <td style="padding:12px 28px 32px;">
                <p style="margin:0 0 8px;font-size:14px;line-height:22px;color:#71717a;">${inviter} 邀请你加入工作区</p>
                <h1 style="margin:0 0 12px;font-size:24px;line-height:32px;font-weight:700;color:#18181b;">${workspaceName}</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:24px;color:#52525b;">你将以${role}身份加入该工作区。</p>
                <a href="${url}" style="display:inline-block;padding:12px 18px;border-radius:6px;background-color:#18181b;color:#ffffff;font-size:14px;line-height:20px;font-weight:600;text-decoration:none;">接受邀请</a>
                <p style="margin:20px 0 0;font-size:13px;line-height:21px;color:#71717a;">此邀请将在 24 小时后失效，请勿转发给他人。</p>
              </td>
            </tr>
          </table>
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

function parseSmtpPort(value: string | undefined) {
  const port = Number(value ?? "587");
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("SMTP_PORT 必须是有效端口");
  }
  return port;
}
