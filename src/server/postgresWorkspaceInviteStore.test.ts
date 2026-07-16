import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgMemPool } from "../test/pgMemDatabase";
import { migrateDatabase } from "./database/migrations";
import { PostgresWorkspaceInviteStore } from "./postgresWorkspaceInviteStore";
import { WorkspaceInviteTokenService } from "./workspaceInviteTokens";

describe("PostgresWorkspaceInviteStore", () => {
  let now: number;
  let pool: Pool;
  let store: PostgresWorkspaceInviteStore;

  beforeEach(async () => {
    now = 1_000;
    pool = createPgMemPool();
    await migrateDatabase(pool);
    await seedUser(pool, "owner-1", "owner@example.com", "Owner");
    await seedUser(pool, "member-1", "member@example.com", "Member");
    await seedWorkspace(pool, "workspace-1", "Product", "owner-1");
    store = new PostgresWorkspaceInviteStore(pool, {
      auditEventIdFactory: () => `audit-${now}`,
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
});

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
