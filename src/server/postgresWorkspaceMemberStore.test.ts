import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgMemPool } from "../test/pgMemDatabase";
import { migrateDatabase } from "./database/migrations";
import { PostgresWorkspaceMemberStore } from "./postgresWorkspaceMemberStore";

describe("PostgresWorkspaceMemberStore", () => {
  let auditEventSequence: number;
  let pool: Pool;
  let store: PostgresWorkspaceMemberStore;

  beforeEach(async () => {
    auditEventSequence = 0;
    pool = createPgMemPool();
    await migrateDatabase(pool);
    await seedUser(pool, "owner-1", "owner@example.com", "Owner", 1000);
    await seedUser(pool, "member-1", "member@example.com", "Member", 2000);
    await seedUser(pool, "editor-1", "editor@example.com", "Editor", 1500);
    await seedUser(pool, "outsider-1", "outsider@example.com", "Outsider", 3000);
    await seedWorkspace(pool, "workspace-1", "Product", "owner-1");
    await seedMembership(pool, "workspace-1", "editor-1", "editor", 1500);
    await seedMembership(pool, "workspace-1", "member-1", "viewer", 2000);
    store = new PostgresWorkspaceMemberStore(pool, {
      auditEventIdFactory: () => `audit-${++auditEventSequence}`,
      now: () => 4000,
      notifyAccessInvalidation: async () => undefined,
    });
  });

  afterEach(async () => {
    await pool.end();
  });

  it("lists workspace members for any member in role and join order", async () => {
    await expect(store.listMembers("member-1", "workspace-1")).resolves.toEqual([
      {
        displayName: "Owner",
        email: "owner@example.com",
        id: "owner-1",
        joinedAt: 1000,
        role: "owner",
      },
      {
        displayName: "Editor",
        email: "editor@example.com",
        id: "editor-1",
        joinedAt: 1500,
        role: "editor",
      },
      {
        displayName: "Member",
        email: "member@example.com",
        id: "member-1",
        joinedAt: 2000,
        role: "viewer",
      },
    ]);
    await expect(store.listMembers("outsider-1", "workspace-1"))
      .rejects.toMatchObject({ code: "workspace_not_found" });
  });

  it("reports a tombstone only to retained workspace members", async () => {
    await pool.query(
      `UPDATE editor_workspaces
       SET deleted_at = $1, deleted_by = $2, purge_after = $3
       WHERE id = $4`,
      [5_000, "owner-1", 604_805_000, "workspace-1"],
    );

    await expect(store.listMembers("member-1", "workspace-1"))
      .rejects.toMatchObject({ code: "workspace_deleted" });
    await expect(store.listMembers("outsider-1", "workspace-1"))
      .rejects.toMatchObject({ code: "workspace_not_found" });
    await expect(store.updateRole({
      actorUserId: "owner-1",
      memberId: "member-1",
      role: "editor",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "workspace_deleted" });
    await expect(store.removeMember({
      actorUserId: "owner-1",
      memberId: "member-1",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "workspace_deleted" });
    await expect(store.transferOwnership({
      actorUserId: "owner-1",
      retainOwnerRole: true,
      targetUserId: "editor-1",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "workspace_deleted" });
    await expect(store.leaveWorkspace({
      userDisplayName: "Member",
      userId: "member-1",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "workspace_deleted" });
    await expect(store.updateRole({
      actorUserId: "outsider-1",
      memberId: "member-1",
      role: "editor",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "workspace_not_found" });
    await expect(store.removeMember({
      actorUserId: "outsider-1",
      memberId: "member-1",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "workspace_not_found" });
    await expect(store.transferOwnership({
      actorUserId: "outsider-1",
      retainOwnerRole: true,
      targetUserId: "editor-1",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "workspace_not_found" });
    await expect(store.leaveWorkspace({
      userDisplayName: "Outsider",
      userId: "outsider-1",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "workspace_not_found" });
  });

  it("publishes invalidations for every affected member mutation", async () => {
    const notifications = vi.fn(async (client, event) => {
      await client.query("SELECT 1 AS notification_marker");
      return event;
    });
    store = new PostgresWorkspaceMemberStore(pool, {
      auditEventIdFactory: () => `audit-${++auditEventSequence}`,
      notifyAccessInvalidation: notifications,
      now: () => 4_000,
    });

    await store.updateRole({
      actorUserId: "owner-1",
      memberId: "member-1",
      role: "editor",
      workspaceId: "workspace-1",
    });
    await store.transferOwnership({
      actorUserId: "owner-1",
      retainOwnerRole: false,
      targetUserId: "editor-1",
      workspaceId: "workspace-1",
    });
    await store.removeMember({
      actorUserId: "editor-1",
      memberId: "member-1",
      workspaceId: "workspace-1",
    });
    await store.leaveWorkspace({
      userDisplayName: "Owner",
      userId: "owner-1",
      workspaceId: "workspace-1",
    });

    expect(notifications).toHaveBeenNthCalledWith(1, expect.anything(), {
      userId: "member-1",
      workspaceId: "workspace-1",
    });
    expect(notifications).toHaveBeenNthCalledWith(2, expect.anything(), {
      userId: "editor-1",
      workspaceId: "workspace-1",
    });
    expect(notifications).toHaveBeenNthCalledWith(3, expect.anything(), {
      userId: "owner-1",
      workspaceId: "workspace-1",
    });
    expect(notifications).toHaveBeenNthCalledWith(4, expect.anything(), {
      userId: "member-1",
      workspaceId: "workspace-1",
    });
    expect(notifications).toHaveBeenNthCalledWith(5, expect.anything(), {
      userId: "owner-1",
      workspaceId: "workspace-1",
    });
    expect(notifications).toHaveBeenCalledTimes(5);
  });

  it("changes a member role, writes an audit event, and protects the last owner", async () => {
    await expect(store.updateRole({
      actorUserId: "owner-1",
      memberId: "member-1",
      role: "editor",
      workspaceId: "workspace-1",
    })).resolves.toBeUndefined();

    await expect(pool.query(
      "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
      ["workspace-1", "member-1"],
    )).resolves.toMatchObject({ rows: [{ role: "editor" }] });
    await expect(pool.query(
      `SELECT actor_user_id, event_type, metadata, target_id, target_type, workspace_name
       FROM workspace_audit_events
       WHERE workspace_id = $1`,
      ["workspace-1"],
    )).resolves.toMatchObject({
      rows: [{
        actor_user_id: "owner-1",
        event_type: "workspace_member_role_changed",
        metadata: { previousRole: "viewer", role: "editor" },
        target_id: "member-1",
        target_type: "workspace_member",
        workspace_name: "Product",
      }],
    });

    await expect(store.updateRole({
      actorUserId: "owner-1",
      memberId: "owner-1",
      role: "editor",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "last_owner_protected" });
  });

  it("allows an owner to be demoted while another owner remains", async () => {
    await seedMembership(pool, "workspace-1", "member-1", "owner", 2000, true);

    await expect(store.updateRole({
      actorUserId: "owner-1",
      memberId: "owner-1",
      role: "viewer",
      workspaceId: "workspace-1",
    })).resolves.toBeUndefined();

    await expect(pool.query(
      "SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
      ["workspace-1", "owner-1"],
    )).resolves.toMatchObject({ rows: [{ role: "viewer" }] });
  });

  it("transfers ownership and optionally demotes the actor", async () => {
    await expect(store.transferOwnership({
      actorUserId: "owner-1",
      retainOwnerRole: false,
      targetUserId: "editor-1",
      workspaceId: "workspace-1",
    })).resolves.toBeUndefined();

    await expect(pool.query(
      `SELECT user_id, role
       FROM workspace_members
       WHERE workspace_id = $1 AND user_id IN ($2, $3)
       ORDER BY user_id`,
      ["workspace-1", "editor-1", "owner-1"],
    )).resolves.toMatchObject({
      rows: [
        { role: "owner", user_id: "editor-1" },
        { role: "editor", user_id: "owner-1" },
      ],
    });
    await expect(pool.query(
      `SELECT actor_user_id, event_type, metadata, target_id, target_type
       FROM workspace_audit_events
       WHERE workspace_id = $1`,
      ["workspace-1"],
    )).resolves.toMatchObject({
      rows: [{
        actor_user_id: "owner-1",
        event_type: "workspace_ownership_transferred",
        metadata: { previousRole: "editor", retainOwnerRole: false },
        target_id: "editor-1",
        target_type: "workspace_member",
      }],
    });

    await expect(store.transferOwnership({
      actorUserId: "editor-1",
      retainOwnerRole: true,
      targetUserId: "member-1",
      workspaceId: "workspace-1",
    })).resolves.toBeUndefined();
    await expect(pool.query(
      `SELECT user_id, role
       FROM workspace_members
       WHERE workspace_id = $1 AND user_id IN ($2, $3)
       ORDER BY user_id`,
      ["workspace-1", "editor-1", "member-1"],
    )).resolves.toMatchObject({
      rows: [
        { role: "owner", user_id: "editor-1" },
        { role: "owner", user_id: "member-1" },
      ],
    });
  });

  it("rejects ownership transfer targets that are missing or already owners", async () => {
    await expect(store.transferOwnership({
      actorUserId: "owner-1",
      retainOwnerRole: true,
      targetUserId: "missing-member",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "ownership_target_invalid" });
    await expect(store.transferOwnership({
      actorUserId: "owner-1",
      retainOwnerRole: true,
      targetUserId: "owner-1",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "ownership_target_invalid" });
  });

  it("removes membership, document preferences, and selects the earliest fallback", async () => {
    await seedWorkspace(pool, "workspace-2", "Later", "outsider-1", 3000);
    await seedMembership(pool, "workspace-2", "member-1", "viewer", 3100);
    await seedWorkspace(pool, "workspace-3", "Earlier", "editor-1", 2500);
    await seedMembership(pool, "workspace-3", "member-1", "editor", 2600);
    await pool.query(
      `INSERT INTO workspace_preferences (user_id, selected_workspace_id)
       VALUES ($1, $2)`,
      ["member-1", "workspace-1"],
    );
    await pool.query(
      `INSERT INTO workspace_document_preferences
         (user_id, workspace_id, active_document_id, updated_at)
       VALUES ($1, $2, NULL, $3)`,
      ["member-1", "workspace-1", 3000],
    );
    await pool.query(
      `INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at)
       VALUES ($1, $2, $3, $4)`,
      ["member-session", "member-1", 9000, 3000],
    );

    await expect(store.removeMember({
      actorUserId: "owner-1",
      memberId: "member-1",
      workspaceId: "workspace-1",
    })).resolves.toBeUndefined();

    await expect(pool.query(
      "SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
      ["workspace-1", "member-1"],
    )).resolves.toMatchObject({ rows: [] });
    await expect(pool.query(
      "SELECT 1 FROM workspace_document_preferences WHERE workspace_id = $1 AND user_id = $2",
      ["workspace-1", "member-1"],
    )).resolves.toMatchObject({ rows: [] });
    await expect(pool.query(
      "SELECT selected_workspace_id FROM workspace_preferences WHERE user_id = $1",
      ["member-1"],
    )).resolves.toMatchObject({ rows: [{ selected_workspace_id: "workspace-3" }] });
    await expect(pool.query(
      "SELECT 1 FROM auth_sessions WHERE user_id = $1",
      ["member-1"],
    )).resolves.toMatchObject({ rows: [{}] });
    await expect(pool.query(
      `SELECT actor_user_id, event_type, target_id, target_type
       FROM workspace_audit_events
       WHERE workspace_id = $1`,
      ["workspace-1"],
    )).resolves.toMatchObject({
      rows: [{
        actor_user_id: "owner-1",
        event_type: "workspace_member_removed",
        target_id: "member-1",
        target_type: "workspace_member",
      }],
    });
  });

  it("leaves a workspace and provisions a personal fallback in the same transaction", async () => {
    await pool.query(
      `INSERT INTO workspace_preferences (user_id, selected_workspace_id)
       VALUES ($1, $2)`,
      ["member-1", "workspace-1"],
    );

    const result = await store.leaveWorkspace({
      userDisplayName: "Member",
      userId: "member-1",
      workspaceId: "workspace-1",
    });

    expect(result.selectedWorkspaceId).not.toBe("workspace-1");
    await expect(pool.query(
      `SELECT workspaces.id, workspaces.name, members.role
       FROM workspace_members members
       INNER JOIN editor_workspaces workspaces ON workspaces.id = members.workspace_id
       WHERE members.user_id = $1`,
      ["member-1"],
    )).resolves.toMatchObject({
      rows: [{
        id: result.selectedWorkspaceId,
        name: "Member的工作区",
        role: "owner",
      }],
    });
    await expect(pool.query(
      "SELECT selected_workspace_id FROM workspace_preferences WHERE user_id = $1",
      ["member-1"],
    )).resolves.toMatchObject({
      rows: [{ selected_workspace_id: result.selectedWorkspaceId }],
    });
    await expect(pool.query(
      `SELECT actor_user_id, event_type, target_id
       FROM workspace_audit_events
       WHERE workspace_id = $1`,
      ["workspace-1"],
    )).resolves.toMatchObject({
      rows: [{
        actor_user_id: "member-1",
        event_type: "workspace_member_left",
        target_id: "member-1",
      }],
    });
  });

  it("protects the last owner and requires owners to use the leave operation", async () => {
    await expect(store.leaveWorkspace({
      userDisplayName: "Owner",
      userId: "owner-1",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "last_owner_protected" });
    await expect(store.removeMember({
      actorUserId: "owner-1",
      memberId: "owner-1",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "member_self_remove_forbidden" });
  });

  it("locks the affected user before reading a possibly absent workspace preference", async () => {
    const client = await pool.connect();
    const query = vi.spyOn(client, "query");
    pool.connect = (() => Promise.resolve(client)) as Pool["connect"];

    await store.removeMember({
      actorUserId: "owner-1",
      memberId: "member-1",
      workspaceId: "workspace-1",
    });

    const statements = query.mock.calls.map(([statement]) => String(statement));
    const userLockIndex = statements.findIndex((statement) =>
      statement.includes("FROM app_users") && statement.includes("FOR UPDATE"));
    const preferenceReadIndex = statements.findIndex((statement) =>
      statement.includes("FROM workspace_preferences") && statement.includes("FOR UPDATE"));
    const membershipDeleteIndex = statements.findIndex((statement) =>
      statement.includes("DELETE FROM workspace_members"));
    expect(userLockIndex).toBeGreaterThan(-1);
    expect(preferenceReadIndex).toBeGreaterThan(userLockIndex);
    expect(membershipDeleteIndex).toBeGreaterThan(preferenceReadIndex);
  });

  it("validates the requested role, actor ownership, and target membership", async () => {
    await expect(store.updateRole({
      actorUserId: "owner-1",
      memberId: "member-1",
      role: "guest" as "viewer",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "member_role_invalid" });
    await expect(store.updateRole({
      actorUserId: "editor-1",
      memberId: "member-1",
      role: "editor",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "workspace_forbidden" });
    await expect(store.updateRole({
      actorUserId: "owner-1",
      memberId: "missing-member",
      role: "editor",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "member_not_found" });
  });

  it("locks the workspace before reading roles during an update", async () => {
    const client = await pool.connect();
    const query = vi.spyOn(client, "query");
    pool.connect = (() => Promise.resolve(client)) as Pool["connect"];

    await store.updateRole({
      actorUserId: "owner-1",
      memberId: "member-1",
      role: "editor",
      workspaceId: "workspace-1",
    });

    const statements = query.mock.calls.map(([statement]) => String(statement));
    const lockIndex = statements.findIndex((statement) =>
      statement.includes("FROM editor_workspaces") && statement.includes("FOR UPDATE"));
    const roleReadIndex = statements.findIndex((statement) =>
      statement.includes("FROM workspace_members"));
    expect(lockIndex).toBeGreaterThan(-1);
    expect(roleReadIndex).toBeGreaterThan(lockIndex);
  });
});

async function seedUser(
  pool: Pool,
  id: string,
  email: string,
  displayName: string,
  createdAt: number,
) {
  await pool.query(
    "INSERT INTO app_users (id, email, display_name, created_at) VALUES ($1, $2, $3, $4)",
    [id, email, displayName, createdAt],
  );
}

async function seedWorkspace(
  pool: Pool,
  id: string,
  name: string,
  ownerUserId: string,
  createdAt = 1000,
) {
  await pool.query(
    "INSERT INTO editor_workspaces (id, name, updated_at, created_at) VALUES ($1, $2, $3, $3)",
    [id, name, createdAt],
  );
  await seedMembership(pool, id, ownerUserId, "owner", createdAt);
}

async function seedMembership(
  pool: Pool,
  workspaceId: string,
  userId: string,
  role: "owner" | "editor" | "viewer",
  createdAt: number,
  replace = false,
) {
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
     VALUES ($1, $2, $3, $4)
     ${replace ? "ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role" : ""}`,
    [workspaceId, userId, role, createdAt],
  );
}
