import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgMemPool } from "../test/pgMemDatabase";
import { migrateDatabase } from "./database/migrations";
import { PostgresWorkspaceLifecycleStore } from "./postgresWorkspaceLifecycleStore";
import { PostgresWorkspaceInviteStore } from "./postgresWorkspaceInviteStore";
import { WorkspaceInviteTokenService } from "./workspaceInviteTokens";

describe("PostgresWorkspaceInviteStore", () => {
  let now: number;
  let auditEventSequence: number;
  let pool: Pool;
  let store: PostgresWorkspaceInviteStore;

  beforeEach(async () => {
    now = 1_000;
    auditEventSequence = 0;
    pool = createPgMemPool();
    await migrateDatabase(pool);
    await seedUser(pool, "owner-1", "owner@example.com", "Owner");
    await seedUser(pool, "member-1", "member@example.com", "Member");
    await seedWorkspace(pool, "workspace-1", "Product", "owner-1");
    store = new PostgresWorkspaceInviteStore(pool, {
      auditEventIdFactory: () => `audit-${++auditEventSequence}`,
      idFactory: () => "invite-1",
      now: () => now,
      tokenService: new WorkspaceInviteTokenService(
        "test-workspace-invite-secret-at-least-32-bytes",
        () => now,
      ),
    });
  });

  afterEach(async () => {
    await pool.end();
  });

  it("creates one pending invite and expires it on the next owner read", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: " MEMBER@example.com ",
      role: "editor",
      workspaceId: "workspace-1",
    });

    expect(created.invite).toMatchObject({
      deliveryStatus: "pending",
      email: "member@example.com",
      expiresAt: now + 24 * 60 * 60_000,
      invitedBy: { displayName: "Owner", id: "owner-1" },
      role: "editor",
      status: "pending",
      workspaceId: "workspace-1",
    });
    expect(created.rawToken).not.toBe("");
    await expect(store.createInvite({
      actorUserId: "owner-1",
      email: "member@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "invite_pending" });

    now = created.invite.expiresAt;
    await expect(store.listOwnerInvites("owner-1", "workspace-1")).resolves.toEqual([
      expect.objectContaining({ id: "invite-1", status: "expired" }),
    ]);
    await store.listOwnerInvites("owner-1", "workspace-1");

    const auditEvents = await pool.query(
      `SELECT event_type, metadata
       FROM workspace_audit_events
       WHERE workspace_id = $1
       ORDER BY event_type ASC`,
      ["workspace-1"],
    );
    expect(auditEvents.rows).toEqual([
      { event_type: "workspace_invite_created", metadata: { role: "editor" } },
      { event_type: "workspace_invite_expired", metadata: { status: "expired" } },
    ]);
  });

  it("requires an owner, a valid invite role, and a non-member recipient", async () => {
    await seedUser(pool, "editor-1", "editor@example.com", "Editor");
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
       VALUES ($1, $2, 'editor', $3)`,
      ["workspace-1", "editor-1", now],
    );
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
       VALUES ($1, $2, 'viewer', $3)`,
      ["workspace-1", "member-1", now],
    );

    await expect(store.createInvite({
      actorUserId: "editor-1",
      email: "new@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "workspace_forbidden" });
    await expect(store.createInvite({
      actorUserId: "owner-1",
      email: "new@example.com",
      role: "owner" as "editor",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "invite_role_invalid" });
    await expect(store.createInvite({
      actorUserId: "owner-1",
      email: "MEMBER@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "already_member" });
  });

  it("rejects a new owner invitation after its workspace is deleted", async () => {
    await deleteWorkspace(pool, now);

    await expect(store.createInvite({
      actorUserId: "owner-1",
      email: "recipient@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "workspace_deleted" });
  });

  it("does not disclose a deleted workspace to a non-member invitation actor", async () => {
    await seedUser(pool, "stranger-1", "stranger@example.com", "Stranger");
    await deleteWorkspace(pool, now);

    await expect(store.createInvite({
      actorUserId: "stranger-1",
      email: "recipient@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "workspace_not_found" });
  });

  it("lists only the recipient's valid pending invitations without exposing a token", async () => {
    await store.createInvite({
      actorUserId: "owner-1",
      email: "member@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    });

    await expect(store.listReceivedInvites("member-1", " MEMBER@example.com "))
      .resolves.toEqual([
        expect.objectContaining({
          id: "invite-1",
          invitedBy: { displayName: "Owner", id: "owner-1" },
          maskedEmail: "m***@example.com",
          role: "viewer",
          workspaceId: "workspace-1",
          workspaceName: "Product",
        }),
      ]);
  });

  it("rotates a pending invite token when an owner resends it", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "recipient@example.com",
      role: "editor",
      workspaceId: "workspace-1",
    });
    const originalTokenHash = await inviteTokenHash(pool, created.invite.id);

    now += 61_000;
    const resent = await store.resendInvite("owner-1", "workspace-1", created.invite.id);

    expect(resent.rawToken).not.toBe(created.rawToken);
    expect(resent.invite).toMatchObject({
      deliveryStatus: "pending",
      expiresAt: now + 24 * 60 * 60_000,
      id: created.invite.id,
      status: "pending",
      updatedAt: now,
    });
    await expect(inviteTokenHash(pool, created.invite.id)).resolves.not.toBe(originalTokenHash);
    await expect(inviteTokenCount(pool, created.rawToken)).resolves.toBe(0);
    await expect(inviteDeliveryAttemptAt(pool, created.invite.id)).resolves.toBe(now);
    await expect(pool.query(
      `SELECT event_type, metadata
       FROM workspace_audit_events
       WHERE target_id = $1
       ORDER BY created_at ASC`,
      [created.invite.id],
    )).resolves.toMatchObject({
      rows: [
        { event_type: "workspace_invite_created", metadata: { role: "editor" } },
        { event_type: "workspace_invite_resent", metadata: { status: "pending" } },
      ],
    });

    now += 59_000;
    await expect(store.resendInvite("owner-1", "workspace-1", created.invite.id))
      .rejects.toMatchObject({ code: "invite_rate_limited" });
  });

  it("resolves a raw token without exposing it and rejects the rotated token", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "recipient@example.com",
      role: "editor",
      workspaceId: "workspace-1",
    });

    await expect(store.resolveRawToken(created.rawToken)).resolves.toEqual({
      expiresAt: created.invite.expiresAt,
      id: created.invite.id,
      invitedBy: { displayName: "Owner", id: "owner-1" },
      maskedEmail: "r***@example.com",
      role: "editor",
      workspaceId: "workspace-1",
      workspaceName: "Product",
    });

    now += 61_000;
    const resent = await store.resendInvite("owner-1", "workspace-1", created.invite.id);

    await expect(store.resolveRawToken(created.rawToken))
      .rejects.toMatchObject({ code: "invite_not_found" });
    await expect(store.resolveRawToken(resent.rawToken)).resolves.toMatchObject({
      id: created.invite.id,
      workspaceName: "Product",
    });
  });

  it("persists delivery results and starts the resend cooldown on the first delivery", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "recipient@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    });

    await expect(store.markDeliveryResult(
      "owner-1",
      "workspace-1",
      created.invite.id,
      created.rawToken,
      "sent",
    )).resolves.toMatchObject({
      deliveryStatus: "sent",
      lastSentAt: now,
      updatedAt: now,
    });
    await expect(inviteDeliveryAttemptAt(pool, created.invite.id)).resolves.toBe(now);
    await expect(store.resendInvite("owner-1", "workspace-1", created.invite.id))
      .rejects.toMatchObject({ code: "invite_rate_limited" });

    now += 61_000;
    await expect(store.markDeliveryResult(
      "owner-1",
      "workspace-1",
      created.invite.id,
      created.rawToken,
      "failed",
    )).resolves.toMatchObject({
      deliveryStatus: "failed",
      lastSentAt: 1_000,
      updatedAt: now,
    });
    await expect(inviteDeliveryAttemptAt(pool, created.invite.id)).resolves.toBe(now);
  });

  it("ignores a delayed delivery result for a token replaced by resend", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "recipient@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    });

    now += 61_000;
    const resent = await store.resendInvite("owner-1", "workspace-1", created.invite.id);

    await expect(store.markDeliveryResult(
      "owner-1",
      "workspace-1",
      created.invite.id,
      created.rawToken,
      "sent",
    )).resolves.toBeNull();
    await expect(pool.query(
      `SELECT delivery_status, last_delivery_attempt_at, last_sent_at, updated_at
       FROM workspace_invites
       WHERE id = $1`,
      [created.invite.id],
    )).resolves.toMatchObject({
      rows: [{
        delivery_status: "pending",
        last_delivery_attempt_at: now,
        last_sent_at: null,
        updated_at: now,
      }],
    });

    await expect(store.markDeliveryResult(
      "owner-1",
      "workspace-1",
      created.invite.id,
      resent.rawToken,
      "sent",
    )).resolves.toMatchObject({ deliveryStatus: "sent", lastSentAt: now });
  });

  it("expires a raw token before returning its terminal state", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "recipient@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    });
    now = created.invite.expiresAt;

    await expect(store.resolveRawToken(created.rawToken))
      .rejects.toMatchObject({ code: "invite_expired" });
    await expect(pool.query(
      "SELECT status FROM workspace_invites WHERE id = $1",
      [created.invite.id],
    )).resolves.toMatchObject({ rows: [{ status: "expired" }] });
  });

  it("reports terminal status codes when resolving a current raw token", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "recipient@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    });
    const terminalStates = [
      ["accepted", "invite_already_accepted"],
      ["declined", "invite_declined"],
      ["revoked", "invite_revoked"],
    ] as const;

    for (const [status, code] of terminalStates) {
      await pool.query(
        "UPDATE workspace_invites SET status = $1 WHERE id = $2",
        [status, created.invite.id],
      );

      await expect(store.resolveRawToken(created.rawToken))
        .rejects.toMatchObject({ code });
    }
  });

  it("revokes a pending invite once and prevents subsequent resends", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "recipient@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    });

    now += 61_000;
    await store.revokeInvite("owner-1", "workspace-1", created.invite.id);

    await expect(pool.query(
      `SELECT status, revoked_at, updated_at
       FROM workspace_invites
       WHERE id = $1`,
      [created.invite.id],
    )).resolves.toMatchObject({
      rows: [{ revoked_at: now, status: "revoked", updated_at: now }],
    });
    await expect(store.resendInvite("owner-1", "workspace-1", created.invite.id))
      .rejects.toMatchObject({ code: "invite_revoked" });
    await expect(store.revokeInvite("owner-1", "workspace-1", created.invite.id))
      .rejects.toMatchObject({ code: "invite_revoked" });
    await expect(pool.query(
      `SELECT COUNT(*)::int AS count
       FROM workspace_audit_events
       WHERE event_type = 'workspace_invite_revoked' AND target_id = $1`,
      [created.invite.id],
    )).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("rejects resend and revoke with the terminal invite state code", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "recipient@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    });
    const terminalStates = [
      ["accepted", "invite_already_accepted"],
      ["declined", "invite_declined"],
      ["expired", "invite_expired"],
      ["revoked", "invite_revoked"],
    ] as const;

    for (const [status, code] of terminalStates) {
      await pool.query(
        "UPDATE workspace_invites SET status = $1 WHERE id = $2",
        [status, created.invite.id],
      );

      await expect(store.resendInvite("owner-1", "workspace-1", created.invite.id))
        .rejects.toMatchObject({ code });
      await expect(store.revokeInvite("owner-1", "workspace-1", created.invite.id))
        .rejects.toMatchObject({ code });
    }
  });

  it("persists lazy expiry before rejecting an invite transition", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "recipient@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    });
    now = created.invite.expiresAt;

    await expect(store.revokeInvite("owner-1", "workspace-1", created.invite.id))
      .rejects.toMatchObject({ code: "invite_expired" });

    await expect(pool.query(
      "SELECT status FROM workspace_invites WHERE id = $1",
      [created.invite.id],
    )).resolves.toMatchObject({ rows: [{ status: "expired" }] });
    await expect(pool.query(
      `SELECT COUNT(*)::int AS count
       FROM workspace_audit_events
       WHERE event_type = 'workspace_invite_expired' AND target_id = $1`,
      [created.invite.id],
    )).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("accepts a matching invite once with membership, preference, and audit in one transaction", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "member@example.com",
      role: "editor",
      workspaceId: "workspace-1",
    });

    await expect(store.acceptInvite({
      inviteId: created.invite.id,
      tokenHash: null,
      userEmail: " MEMBER@example.com ",
      userId: "member-1",
    })).resolves.toEqual({ workspaceId: "workspace-1" });

    await expect(pool.query(
      `SELECT role
       FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2`,
      ["workspace-1", "member-1"],
    )).resolves.toMatchObject({ rows: [{ role: "editor" }] });
    await expect(pool.query(
      `SELECT active_document_id, updated_at
       FROM workspace_document_preferences
       WHERE workspace_id = $1 AND user_id = $2`,
      ["workspace-1", "member-1"],
    )).resolves.toMatchObject({
      rows: [{ active_document_id: null, updated_at: now }],
    });
    await expect(pool.query(
      `SELECT accepted_at, accepted_by, status
       FROM workspace_invites
       WHERE id = $1`,
      [created.invite.id],
    )).resolves.toMatchObject({
      rows: [{ accepted_at: now, accepted_by: "member-1", status: "accepted" }],
    });
    await expect(pool.query(
      `SELECT actor_user_id, event_type, metadata
       FROM workspace_audit_events
       WHERE target_id = $1 AND event_type = 'workspace_invite_accepted'`,
      [created.invite.id],
    )).resolves.toMatchObject({
      rows: [{
        actor_user_id: "member-1",
        event_type: "workspace_invite_accepted",
        metadata: { role: "editor", status: "accepted" },
      }],
    });
    await expect(store.acceptInvite({
      inviteId: created.invite.id,
      tokenHash: null,
      userEmail: "member@example.com",
      userId: "member-1",
    })).rejects.toMatchObject({ code: "invite_already_accepted" });
  });

  it("restores invite metadata only for the matching signed context and recipient", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "member@example.com",
      role: "editor",
      workspaceId: "workspace-1",
    });
    const tokenService = new WorkspaceInviteTokenService(
      "test-workspace-invite-secret-at-least-32-bytes",
    );
    const context = {
      inviteId: created.invite.id,
      tokenHash: tokenService.hashRawToken(created.rawToken),
      userEmail: "member@example.com",
      userId: "member-1",
    };

    await expect(store.resolveInviteContext(context)).resolves.toMatchObject({
      id: created.invite.id,
      maskedEmail: "m***@example.com",
      workspaceId: "workspace-1",
      workspaceName: "Product",
    });
    await expect(store.resolveInviteContext({
      ...context,
      tokenHash: tokenService.hashRawToken("stale-token"),
    })).rejects.toMatchObject({ code: "invite_not_found" });
    await expect(store.resolveInviteContext({
      ...context,
      userEmail: "other@example.com",
    })).rejects.toMatchObject({ code: "invite_email_mismatch" });
  });

  it("rejects acceptance when the session email or context token does not match", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "member@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    });
    const tokenService = new WorkspaceInviteTokenService(
      "test-workspace-invite-secret-at-least-32-bytes",
    );

    await expect(store.acceptInvite({
      inviteId: created.invite.id,
      tokenHash: null,
      userEmail: "other@example.com",
      userId: "member-1",
    })).rejects.toMatchObject({ code: "invite_email_mismatch" });
    await expect(store.acceptInvite({
      inviteId: created.invite.id,
      tokenHash: tokenService.hashRawToken("stale-token"),
      userEmail: "member@example.com",
      userId: "member-1",
    })).rejects.toMatchObject({ code: "invite_not_found" });
    await expect(pool.query(
      "SELECT status FROM workspace_invites WHERE id = $1",
      [created.invite.id],
    )).resolves.toMatchObject({ rows: [{ status: "pending" }] });
  });

  it("declines a matching pending invite and rejects a second transition", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "member@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    });

    await expect(store.declineInvite({
      inviteId: created.invite.id,
      tokenHash: null,
      userEmail: "member@example.com",
      userId: "member-1",
    })).resolves.toBeUndefined();

    await expect(pool.query(
      `SELECT declined_at, declined_by, status
       FROM workspace_invites
       WHERE id = $1`,
      [created.invite.id],
    )).resolves.toMatchObject({
      rows: [{ declined_at: now, declined_by: "member-1", status: "declined" }],
    });
    await expect(pool.query(
      `SELECT actor_user_id, event_type, metadata
       FROM workspace_audit_events
       WHERE target_id = $1 AND event_type = 'workspace_invite_declined'`,
      [created.invite.id],
    )).resolves.toMatchObject({
      rows: [{
        actor_user_id: "member-1",
        event_type: "workspace_invite_declined",
        metadata: { status: "declined" },
      }],
    });
    await expect(store.declineInvite({
      inviteId: created.invite.id,
      tokenHash: null,
      userEmail: "member@example.com",
      userId: "member-1",
    })).rejects.toMatchObject({ code: "invite_declined" });
  });

  it("expires an invite before rejecting a recipient acceptance", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "member@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    });
    now = created.invite.expiresAt;

    await expect(store.acceptInvite({
      inviteId: created.invite.id,
      tokenHash: null,
      userEmail: "member@example.com",
      userId: "member-1",
    })).rejects.toMatchObject({ code: "invite_expired" });
    await expect(pool.query(
      "SELECT status FROM workspace_invites WHERE id = $1",
      [created.invite.id],
    )).resolves.toMatchObject({ rows: [{ status: "expired" }] });
  });

  it("does not accept a recipient invitation after its workspace is deleted", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "member@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    });
    await deleteWorkspace(pool, now);

    await expect(store.acceptInvite({
      inviteId: created.invite.id,
      tokenHash: null,
      userEmail: "member@example.com",
      userId: "member-1",
    })).rejects.toMatchObject({ code: "workspace_not_found" });
    await expect(pool.query(
      `SELECT user_id
       FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2`,
      ["workspace-1", "member-1"],
    )).resolves.toMatchObject({ rows: [] });
  });

  it("reports a deleted workspace to a retained invitation recipient", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "member@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    });
    const recipient = {
      inviteId: created.invite.id,
      tokenHash: null,
      userEmail: "member@example.com",
      userId: "member-1",
    };
    await store.acceptInvite(recipient);
    await tombstoneWorkspace(pool, now);

    await expect(store.acceptInvite(recipient))
      .rejects.toMatchObject({ code: "workspace_deleted" });
  });

  it("blocks every remaining invitation transition for a deleted workspace", async () => {
    const created = await store.createInvite({
      actorUserId: "owner-1",
      email: "member@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    });
    const recipient = {
      inviteId: created.invite.id,
      tokenHash: null,
      userEmail: "member@example.com",
      userId: "member-1",
    };
    await deleteWorkspace(pool, now);

    await expect(store.assertOwnerAccess("owner-1", "workspace-1"))
      .rejects.toMatchObject({ code: "workspace_deleted" });
    await expect(store.listOwnerInvites("owner-1", "workspace-1"))
      .rejects.toMatchObject({ code: "workspace_deleted" });
    await expect(store.resendInvite("owner-1", "workspace-1", created.invite.id))
      .rejects.toMatchObject({ code: "workspace_deleted" });
    await expect(store.revokeInvite("owner-1", "workspace-1", created.invite.id))
      .rejects.toMatchObject({ code: "workspace_deleted" });
    await expect(store.markDeliveryResult(
      "owner-1",
      "workspace-1",
      created.invite.id,
      created.rawToken,
      "sent",
    )).rejects.toMatchObject({ code: "workspace_deleted" });
    await expect(store.resolveRawToken(created.rawToken))
      .rejects.toMatchObject({ code: "workspace_not_found" });
    await expect(store.resolveInviteContext(recipient))
      .rejects.toMatchObject({ code: "workspace_not_found" });
    await expect(store.declineInvite(recipient))
      .rejects.toMatchObject({ code: "workspace_not_found" });
  });

  it("hides a pending tombstone invitation from the recipient list", async () => {
    await store.createInvite({
      actorUserId: "owner-1",
      email: "member@example.com",
      role: "viewer",
      workspaceId: "workspace-1",
    });
    await tombstoneWorkspace(pool, now);

    await expect(store.listReceivedInvites("member-1", "member@example.com"))
      .resolves.toEqual([]);
  });
});

async function deleteWorkspace(pool: Pool, now: number) {
  let auditSequence = 0;
  const lifecycleStore = new PostgresWorkspaceLifecycleStore(pool, {
    auditEventIdFactory: () => `lifecycle-audit-${now}-${++auditSequence}`,
    now: () => now,
    notifyAccessInvalidation: async () => undefined,
  });
  await lifecycleStore.deleteWorkspace({
    actorUserId: "owner-1",
    confirmationName: "Product",
    workspaceId: "workspace-1",
  });
}

async function tombstoneWorkspace(pool: Pool, now: number) {
  await pool.query(
    `UPDATE editor_workspaces
     SET deleted_at = $1, deleted_by = $2, purge_after = $3
     WHERE id = $4`,
    [now, "owner-1", now + 7 * 24 * 60 * 60_000, "workspace-1"],
  );
}

async function inviteDeliveryAttemptAt(pool: Pool, inviteId: string) {
  const result = await pool.query(
    "SELECT last_delivery_attempt_at FROM workspace_invites WHERE id = $1",
    [inviteId],
  );
  return Number(result.rows[0]?.last_delivery_attempt_at);
}

async function inviteTokenCount(pool: Pool, rawToken: string) {
  const tokenHash = new WorkspaceInviteTokenService(
    "test-workspace-invite-secret-at-least-32-bytes",
  ).hashRawToken(rawToken);
  const result = await pool.query(
    "SELECT COUNT(*)::int AS count FROM workspace_invites WHERE token_hash = $1",
    [tokenHash],
  );
  return Number(result.rows[0]?.count);
}

async function inviteTokenHash(pool: Pool, inviteId: string) {
  const result = await pool.query(
    "SELECT token_hash FROM workspace_invites WHERE id = $1",
    [inviteId],
  );
  return String(result.rows[0]?.token_hash);
}

async function seedUser(pool: Pool, id: string, email: string, displayName: string) {
  await pool.query(
    "INSERT INTO app_users (id, email, display_name, created_at) VALUES ($1, $2, $3, $4)",
    [id, email, displayName, 1_000],
  );
}

async function seedWorkspace(
  pool: Pool,
  id: string,
  name: string,
  ownerId: string,
) {
  await pool.query(
    `INSERT INTO editor_workspaces (id, name, updated_at, created_at)
     VALUES ($1, $2, $3, $3)`,
    [id, name, 1_000],
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
     VALUES ($1, $2, 'owner', $3)`,
    [id, ownerId, 1_000],
  );
}
