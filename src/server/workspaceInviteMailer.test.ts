import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  WorkspaceInviteMailer,
  createWorkspaceInviteMailerFromEnvironment,
} from "./workspaceInviteMailer";

const invitation = {
  email: "member@example.com",
  inviterDisplayName: "林夏",
  role: "editor" as const,
  url: "https://nexus.example/invitations/accept#token=raw-token",
  workspaceName: "产品研发中心",
};

describe("WorkspaceInviteMailer", () => {
  it("sends a 24 hour invitation without logging the raw token", async () => {
    const transport = { sendMail: vi.fn().mockResolvedValue({ messageId: "mail-1" }) };
    const logger = { info: vi.fn() };
    const mailer = new WorkspaceInviteMailer({
      from: "Nexus <noreply@example.com>",
      logger,
      production: true,
      transport,
    });

    await mailer.send(invitation);

    expect(transport.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "Nexus <noreply@example.com>",
      subject: "林夏邀请你加入产品研发中心",
      to: "member@example.com",
    }));
    const message = transport.sendMail.mock.calls[0][0];
    expect(message.text).toContain("24 小时");
    expect(message.text).toContain(invitation.url);
    expect(message.html).toContain(invitation.url);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("raw-token");
  });

  it("captures the invitation URL only in the explicitly configured capture file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workspace-invite-mail-capture-"));
    const captureFile = join(directory, "mail.jsonl");
    vi.stubEnv("AUTH_MAIL_CAPTURE_FILE", captureFile);
    vi.stubEnv("AUTH_MAIL_CAPTURE_ALLOW_PRODUCTION", "true");
    vi.stubEnv("NODE_ENV", "production");

    try {
      const mailer = createWorkspaceInviteMailerFromEnvironment();
      await mailer.send(invitation);
      const captures = (await readFile(captureFile, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));

      expect(captures).toEqual([expect.objectContaining({
        purpose: "workspace-invite",
        subject: "林夏邀请你加入产品研发中心",
        to: "member@example.com",
        url: invitation.url,
      })]);
      expect(captures[0].createdAt).toEqual(expect.any(Number));
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("requires explicit authorization for production mail capture", () => {
    vi.stubEnv("AUTH_MAIL_CAPTURE_FILE", "/tmp/workspace-invite-mail-capture.jsonl");
    vi.stubEnv("AUTH_MAIL_CAPTURE_ALLOW_PRODUCTION", "false");
    vi.stubEnv("NODE_ENV", "production");

    try {
      expect(() => createWorkspaceInviteMailerFromEnvironment())
        .toThrow("生产环境邮件捕获未显式授权");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("requires SMTP delivery in production", async () => {
    const mailer = new WorkspaceInviteMailer({
      from: "Nexus <noreply@example.com>",
      logger: { info: vi.fn() },
      production: true,
    });

    await expect(mailer.send(invitation)).rejects.toThrow("SMTP 未配置");
  });
});
