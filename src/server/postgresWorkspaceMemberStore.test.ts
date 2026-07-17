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
) {
  await pool.query(
    "INSERT INTO editor_workspaces (id, name, updated_at, created_at) VALUES ($1, $2, $3, $3)",
    [id, name, 1000],
  );
  await seedMembership(pool, id, ownerUserId, "owner", 1000);
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
