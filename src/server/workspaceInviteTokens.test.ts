// @vitest-environment node

import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { WorkspaceInviteTokenService } from "./workspaceInviteTokens";

describe("WorkspaceInviteTokenService", () => {
  it("hashes raw tokens and verifies a short invite context", async () => {
    const service = new WorkspaceInviteTokenService("test-secret", () => 1_000);
    const token = service.createRawToken();
    const tokenHash = service.hashRawToken(token);

    expect(tokenHash).toHaveLength(64);

    const context = await service.signContext({
      expiresAt: 2_000,
      inviteId: "invite-1",
      tokenHash,
    });

    await expect(service.verifyContext(context)).resolves.toEqual({
      expiresAt: 2_000,
      inviteId: "invite-1",
      tokenHash,
    });
  });

  it("caps the context lifetime at thirty minutes", async () => {
    const now = 1_000;
    const service = new WorkspaceInviteTokenService("test-secret", () => now);
    const context = await service.signContext({
      expiresAt: now + 60 * 60_000,
      inviteId: "invite-1",
      tokenHash: "a".repeat(64),
    });

    await expect(service.verifyContext(context)).resolves.toMatchObject({
      expiresAt: now + 30 * 60_000,
    });
  });

  it("rejects an expired context", async () => {
    let now = 1_000;
    const service = new WorkspaceInviteTokenService("test-secret", () => now);
    const context = await service.signContext({
      expiresAt: 2_000,
      inviteId: "invite-1",
      tokenHash: "a".repeat(64),
    });
    now = 2_000;

    await expect(service.verifyContext(context)).rejects.toThrow();
  });

  it("rejects a context signed with another secret", async () => {
    const issuer = new WorkspaceInviteTokenService("issuer-secret", () => 1_000);
    const verifier = new WorkspaceInviteTokenService("verifier-secret", () => 1_000);
    const context = await issuer.signContext({
      expiresAt: 2_000,
      inviteId: "invite-1",
      tokenHash: "a".repeat(64),
    });

    await expect(verifier.verifyContext(context)).rejects.toThrow();
  });

  it.each([
    { audience: "other-audience", issuer: "nexus" },
    { audience: "nexus-workspace-invite", issuer: "other-issuer" },
  ])("rejects contexts with an unexpected issuer or audience", async ({ audience, issuer }) => {
    const service = new WorkspaceInviteTokenService("test-secret", () => 1_000);
    const context = await new SignJWT({
      inviteId: "invite-1",
      tokenHash: "a".repeat(64),
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setAudience(audience)
      .setIssuer(issuer)
      .setExpirationTime(2)
      .sign(new TextEncoder().encode("test-secret"));

    await expect(service.verifyContext(context)).rejects.toThrow();
  });
});
