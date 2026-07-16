import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "@/server/database/migrations";
import { PostgresAuthStore } from "@/server/postgresAuthStore";
import { PostgresWorkspaceInviteStore } from "@/server/postgresWorkspaceInviteStore";
import { PostgresWorkspaceStore } from "@/server/postgresWorkspaceStore";
import type { WorkspaceInviteRateLimiter } from "@/server/workspaceInviteRateLimiter";
import { WorkspaceInviteTokenService } from "@/server/workspaceInviteTokens";
import { createPgMemPool } from "@/test/pgMemDatabase";
import { createWorkspaceInviteRouteHandlers } from "./handlers";

describe("workspace owner invite routes", () => {
  let authStore: PostgresAuthStore;
  let inviteStore: PostgresWorkspaceInviteStore;
  let mailer: { send: ReturnType<typeof vi.fn> };
  let now: number;
  let owner: Awaited<ReturnType<PostgresAuthStore["createSession"]>>;
  let pool: Pool;
  let workspaceId: string;
  let workspaceName: string;

  beforeEach(async () => {
    now = 1_000;
    pool = createPgMemPool();
    await migrateDatabase(pool);
    const workspaceStore = new PostgresWorkspaceStore(pool, { now: () => now });
    authStore = new PostgresAuthStore(pool, workspaceStore, { now: () => now });
    inviteStore = new PostgresWorkspaceInviteStore(pool, {
      idFactory: () => "invite-1",
      now: () => now,
      tokenService: new WorkspaceInviteTokenService(
        "test-workspace-invite-secret-at-least-32-bytes",
        () => now,
      ),
    });
    mailer = { send: vi.fn().mockResolvedValue(undefined) };
    owner = await authStore.createSession({
      displayName: "Owner",
      email: "owner@example.com",
    });
    const catalog = await workspaceStore.listWorkspaces(owner.user.id);
    workspaceId = catalog.currentWorkspaceId;
    workspaceName = catalog.workspaces.find((workspace) => workspace.id === workspaceId)!.name;
  });

  afterEach(async () => {
    await pool.end();
  });

  it("returns a delivery warning after persisting a failed invitation without leaking its token", async () => {
    mailer.send.mockRejectedValueOnce(new Error("SMTP unavailable"));
    const handlers = createHandlers();

    const response = await handlers.POST(
      jsonRequest({ email: "member@example.com", role: "editor" }, owner.token),
      workspaceId,
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({
      deliveryWarning: { code: "invite_delivery_failed" },
      invite: { deliveryStatus: "failed", id: "invite-1" },
    });
    expect(JSON.stringify(body)).not.toContain("raw-token");
    await expect(inviteStore.listOwnerInvites(owner.user.id, workspaceId)).resolves.toEqual([
      expect.objectContaining({ deliveryStatus: "failed", id: "invite-1" }),
    ]);
    const listed = await handlers.GET(authenticatedRequest("GET", owner.token), workspaceId);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      invites: [{ deliveryStatus: "failed", id: "invite-1" }],
    });
  });

  it("sends the persisted invite to the accepted URL and marks it delivered", async () => {
    const handlers = createHandlers();

    const response = await handlers.POST(
      jsonRequest({ email: "member@example.com", role: "viewer" }, owner.token),
      workspaceId,
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      deliveryWarning: null,
      invite: { deliveryStatus: "sent", role: "viewer" },
    });
    expect(mailer.send).toHaveBeenCalledWith(expect.objectContaining({
      email: "member@example.com",
      inviterDisplayName: "Owner",
      role: "viewer",
      url: expect.stringMatching(/^http:\/\/nexus\.test\/invitations\/accept#token=.+$/),
      workspaceName,
    }));
  });

  it("requires an explicit supported invitation role", async () => {
    const handlers = createHandlers();

    const missingRole = await handlers.POST(
      jsonRequest({ email: "member@example.com" }, owner.token),
      workspaceId,
    );
    const invalidRole = await handlers.POST(
      jsonRequest({ email: "member@example.com", role: "owner" }, owner.token),
      workspaceId,
    );

    await expect(missingRole.json()).resolves.toMatchObject({ code: "invite_role_required" });
    await expect(invalidRole.json()).resolves.toMatchObject({ code: "invite_role_invalid" });
    expect(missingRole.status).toBe(400);
    expect(invalidRole.status).toBe(400);
  });

  it("does not allow non-owners to inspect a workspace's invitations", async () => {
    const workspaceStore = new PostgresWorkspaceStore(pool, { now: () => now });
    const editor = await authStore.createSession({
      displayName: "Editor",
      email: "editor@example.com",
    });
    await workspaceStore.addMember(owner.user.id, workspaceId, editor.user.email, "editor");
    const handlers = createHandlers();

    const response = await handlers.GET(
      authenticatedRequest("GET", editor.token),
      workspaceId,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "workspace_forbidden" });
  });

  it("does not consume an invitation quota before verifying owner access", async () => {
    const workspaceStore = new PostgresWorkspaceStore(pool, { now: () => now });
    const editor = await authStore.createSession({
      displayName: "Editor",
      email: "editor@example.com",
    });
    await workspaceStore.addMember(owner.user.id, workspaceId, editor.user.email, "editor");
    const limiter: WorkspaceInviteRateLimiter = {
      consume: vi.fn().mockResolvedValue({
        allowed: true,
        retryAfterMs: 0,
        scope: null,
      }),
    };
    const handlers = createHandlers(limiter);

    const response = await handlers.POST(
      jsonRequest({ email: "member@example.com", role: "editor" }, editor.token),
      workspaceId,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "workspace_forbidden" });
    expect(limiter.consume).not.toHaveBeenCalled();
  });

  it("returns a rounded retry delay when the invitation rate limit is exhausted", async () => {
    const limiter: WorkspaceInviteRateLimiter = {
      consume: vi.fn().mockResolvedValue({
        allowed: false,
        retryAfterMs: 1_501,
        scope: "email",
      }),
    };
    const handlers = createHandlers(limiter);

    const response = await handlers.POST(
      jsonRequest({ email: "member@example.com", role: "editor" }, owner.token),
      workspaceId,
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      code: "invite_rate_limited",
      error: "Invitation rate limit exceeded",
      retryAfterSeconds: 2,
    });
    expect(limiter.consume).toHaveBeenCalledWith(workspaceId, "member@example.com");
  });

  it("resends a pending invite and rejects a resend after revocation", async () => {
    const handlers = createHandlers();
    const created = await handlers.POST(
      jsonRequest({ email: "member@example.com", role: "editor" }, owner.token),
      workspaceId,
    );
    expect(created.status).toBe(201);
    const coolingDown = await handlers.resend(
      authenticatedRequest("POST", owner.token),
      workspaceId,
      "invite-1",
    );
    now += 60_001;

    const resent = await handlers.resend(
      authenticatedRequest("POST", owner.token),
      workspaceId,
      "invite-1",
    );
    const revoked = await handlers.DELETE(
      authenticatedRequest("DELETE", owner.token),
      workspaceId,
      "invite-1",
    );
    const afterRevoke = await handlers.resend(
      authenticatedRequest("POST", owner.token),
      workspaceId,
      "invite-1",
    );

    expect(coolingDown.status).toBe(429);
    await expect(coolingDown.json()).resolves.toMatchObject({
      code: "invite_rate_limited",
      retryAfterSeconds: 60,
    });
    expect(resent.status).toBe(200);
    await expect(resent.json()).resolves.toMatchObject({
      deliveryWarning: null,
      invite: { deliveryStatus: "sent", id: "invite-1" },
    });
    expect(revoked.status).toBe(204);
    expect(afterRevoke.status).toBe(410);
    await expect(afterRevoke.json()).resolves.toMatchObject({ code: "invite_revoked" });
  });

  function createHandlers(limiter: WorkspaceInviteRateLimiter = allowAllLimiter()) {
    return createWorkspaceInviteRouteHandlers({
      appUrl: "http://nexus.test",
      authStore,
      inviteStore,
      limiter,
      mailer,
    });
  }
});

function allowAllLimiter(): WorkspaceInviteRateLimiter {
  return {
    async consume() {
      return { allowed: true, retryAfterMs: 0, scope: null };
    },
  };
}

function authenticatedRequest(method: string, token: string) {
  return new Request("http://localhost", {
    headers: { Cookie: `notion_editor_session=${token}` },
    method,
  });
}

function jsonRequest(payload: unknown, token: string) {
  return new Request("http://localhost", {
    body: JSON.stringify(payload),
    headers: {
      "Content-Type": "application/json",
      Cookie: `notion_editor_session=${token}`,
    },
    method: "POST",
  });
}
