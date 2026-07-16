// @vitest-environment node

import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "@/server/database/migrations";
import { PostgresAuthStore } from "@/server/postgresAuthStore";
import { PostgresWorkspaceInviteStore } from "@/server/postgresWorkspaceInviteStore";
import { PostgresWorkspaceStore } from "@/server/postgresWorkspaceStore";
import { WorkspaceInviteTokenService } from "@/server/workspaceInviteTokens";
import { createPgMemPool } from "@/test/pgMemDatabase";
import { createWorkspaceInviteRecipientRouteHandlers } from "./handlers";

const INVITE_SECRET = "test-workspace-invite-secret-at-least-32-bytes";

describe("workspace invite recipient routes", () => {
  let authStore: PostgresAuthStore;
  let inviteStore: PostgresWorkspaceInviteStore;
  let now: number;
  let owner: Awaited<ReturnType<PostgresAuthStore["createSession"]>>;
  let pool: Pool;
  let recipient: Awaited<ReturnType<PostgresAuthStore["createSession"]>>;
  let tokenService: WorkspaceInviteTokenService;
  let workspaceId: string;

  beforeEach(async () => {
    now = 1_000;
    pool = createPgMemPool();
    await migrateDatabase(pool);
    const workspaceStore = new PostgresWorkspaceStore(pool, { now: () => now });
    authStore = new PostgresAuthStore(pool, workspaceStore, { now: () => now });
    tokenService = new WorkspaceInviteTokenService(INVITE_SECRET, () => now);
    inviteStore = new PostgresWorkspaceInviteStore(pool, {
      idFactory: () => "invite-1",
      now: () => now,
      tokenService,
    });
    owner = await authStore.createSession({
      displayName: "Owner",
      email: "owner@example.com",
    });
    recipient = await authStore.createSession({
      displayName: "Recipient",
      email: "recipient@example.com",
    });
    workspaceId = (await workspaceStore.listWorkspaces(owner.user.id)).currentWorkspaceId;
  });

  afterEach(async () => {
    await pool.end();
  });

  it("resolves a raw token into invite metadata and a short-lived context cookie", async () => {
    const created = await createInvite();
    const handlers = createHandlers();

    const response = await handlers.resolve(jsonRequest({ token: created.rawToken }));

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "nexus_workspace_invite_context=",
    );
    expect(response.headers.get("set-cookie")).not.toContain(created.rawToken);
    const body = await response.json();
    expect(body).toMatchObject({
      invite: { id: "invite-1", maskedEmail: "r***@example.com", workspaceId },
    });
    expect(JSON.stringify(body)).not.toContain(created.rawToken);
  });

  it("returns not found for an invalid raw token", async () => {
    const response = await createHandlers().resolve(jsonRequest({ token: "not-a-real-token" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: "invite_not_found" });
  });

  it("lists only the authenticated recipient's pending invitations", async () => {
    await createInvite();

    const response = await createHandlers().list(authenticatedRequest(recipient.token));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      invites: [{ id: "invite-1", workspaceId }],
    });
  });

  it("requires authentication before listing or transitioning invitations", async () => {
    const handlers = createHandlers();

    const list = await handlers.list(new Request("http://localhost"));
    const accept = await handlers.acceptById(new Request("http://localhost", {
      method: "POST",
    }), "invite-1");

    expect(list.status).toBe(401);
    expect(accept.status).toBe(401);
    await expect(list.json()).resolves.toMatchObject({ code: "authentication_required" });
  });

  it("accepts an in-app invite and returns the selected workspace transition", async () => {
    await createInvite();

    const response = await createHandlers().acceptById(
      authenticatedRequest(recipient.token),
      "invite-1",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      catalog: { currentWorkspaceId: workspaceId },
      workspace: { summary: { id: workspaceId, role: "editor" } },
    });
  });

  it("rejects an in-app transition when the signed-in email does not match", async () => {
    await createInvite();
    const other = await authStore.createSession({
      displayName: "Other",
      email: "other@example.com",
    });

    const response = await createHandlers().acceptById(
      authenticatedRequest(other.token),
      "invite-1",
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "invite_email_mismatch" });
  });

  it("declines an in-app invite and returns its terminal status", async () => {
    await createInvite();

    const response = await createHandlers().declineById(
      authenticatedRequest(recipient.token),
      "invite-1",
    );

    expect(response.status).toBe(204);
    await expect(inviteStore.listReceivedInvites(recipient.user.id, recipient.user.email))
      .resolves.toEqual([]);
  });

  it("accepts a resolved invite from its context cookie and clears that cookie", async () => {
    const created = await createInvite();
    const handlers = createHandlers();
    const resolve = await handlers.resolve(jsonRequest({ token: created.rawToken }));

    const response = await handlers.acceptByContext(
      authenticatedRequest(recipient.token, cookiePair(resolve)),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    await expect(response.json()).resolves.toMatchObject({
      catalog: { currentWorkspaceId: workspaceId },
      workspace: { summary: { id: workspaceId } },
    });
  });

  it("clears a context cookie after a terminal invitation error", async () => {
    const created = await createInvite();
    const handlers = createHandlers();
    const resolve = await handlers.resolve(jsonRequest({ token: created.rawToken }));
    await inviteStore.revokeInvite(owner.user.id, workspaceId, "invite-1");

    const response = await handlers.acceptByContext(
      authenticatedRequest(recipient.token, cookiePair(resolve)),
    );

    expect(response.status).toBe(410);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    await expect(response.json()).resolves.toMatchObject({ code: "invite_revoked" });
  });

  it("returns an expiration status for a lazily expired invitation", async () => {
    await createInvite();
    now += 24 * 60 * 60_000;

    const response = await createHandlers().acceptById(
      authenticatedRequest(recipient.token),
      "invite-1",
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ code: "invite_expired" });
  });

  function createHandlers() {
    return createWorkspaceInviteRecipientRouteHandlers({
      authStore,
      inviteStore,
      tokenService,
      workspaceStore: new PostgresWorkspaceStore(pool, { now: () => now }),
    });
  }

  function createInvite() {
    return inviteStore.createInvite({
      actorUserId: owner.user.id,
      email: recipient.user.email,
      role: "editor",
      workspaceId,
    });
  }
});

function authenticatedRequest(token: string, inviteContext?: string) {
  return new Request("http://localhost", {
    headers: {
      Cookie: [
        `notion_editor_session=${token}`,
        ...(inviteContext ? [inviteContext] : []),
      ].join("; "),
    },
    method: "POST",
  });
}

function cookiePair(response: Response) {
  return response.headers.get("set-cookie")!.split(";", 1)[0];
}

function jsonRequest(payload: unknown) {
  return new Request("http://localhost", {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}
