import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "./database/migrations";
import { PostgresWorkspaceLifecycleStore } from "./postgresWorkspaceLifecycleStore";
import { createPgMemPool } from "../test/pgMemDatabase";

describe("PostgresWorkspaceLifecycleStore", () => {
  let pool: Pool;
  let lifecycleStore: PostgresWorkspaceLifecycleStore;
  let notifyAccessInvalidation: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    pool = createPgMemPool();
    await migrateDatabase(pool);
    notifyAccessInvalidation = vi.fn().mockResolvedValue(undefined);
    lifecycleStore = new PostgresWorkspaceLifecycleStore(pool, {
      auditEventIdFactory: (() => {
        let sequence = 0;
        return () => `audit-${++sequence}`;
      })(),
      now: () => 3_000,
      notifyAccessInvalidation,
    });
    await seedWorkspace(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("returns deletion counts only to an owner", async () => {
    await expect(lifecycleStore.getDeletionSummary("owner-1", "workspace-1"))
      .resolves.toEqual({
        documentCount: 2,
        fileCount: 3,
        id: "workspace-1",
        memberCount: 4,
        name: "Product centre",
      });

    await expect(lifecycleStore.getDeletionSummary("editor-1", "workspace-1"))
      .rejects.toMatchObject({ code: "workspace_forbidden" });
  });

  it("tombstones the workspace, revokes pending invites, audits, and invalidates access", async () => {
    await expect(lifecycleStore.deleteWorkspace({
      actorUserId: "owner-1",
      confirmationName: " Product centre ",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "workspace_name_confirmation_mismatch" });

    await expect(lifecycleStore.deleteWorkspace({
      actorUserId: "owner-1",
      confirmationName: "Product centre",
      workspaceId: "workspace-1",
    })).resolves.toEqual({
      deletedAt: 3_000,
      deletedBy: { displayName: "Owner", id: "owner-1" },
      id: "workspace-1",
      name: "Product centre",
      purgeAfter: 604_803_000,
    });

    await expect(pool.query(
      `SELECT deleted_at, deleted_by, purge_after
       FROM editor_workspaces
       WHERE id = $1`,
      ["workspace-1"],
    )).resolves.toMatchObject({
      rows: [{ deleted_at: 3_000, deleted_by: "owner-1", purge_after: 604_803_000 }],
    });
    await expect(pool.query(
      "SELECT status, revoked_at FROM workspace_invites WHERE id = $1",
      ["invite-pending"],
    )).resolves.toMatchObject({ rows: [{ revoked_at: 3_000, status: "revoked" }] });
    await expect(pool.query(
      "SELECT event_type FROM workspace_audit_events WHERE workspace_id = $1 ORDER BY created_at, id",
      ["workspace-1"],
    )).resolves.toMatchObject({
      rows: [
        { event_type: "workspace_deleted" },
        { event_type: "workspace_invite_revoked" },
      ],
    });
    expect(notifyAccessInvalidation).toHaveBeenCalledWith(expect.anything(), {
      userId: null,
      workspaceId: "workspace-1",
    });
  });

  it("lists owner tombstones and restores a selected workspace before its purge deadline", async () => {
    await pool.query(
      `UPDATE editor_workspaces
       SET deleted_at = $1, deleted_by = $2, purge_after = $3
       WHERE id = $4`,
      [3_000, "owner-1", 604_803_000, "workspace-1"],
    );

    await expect(lifecycleStore.listTrash("owner-1")).resolves.toEqual([
      {
        deletedAt: 3_000,
        deletedBy: { displayName: "Owner", id: "owner-1" },
        id: "workspace-1",
        name: "Product centre",
        purgeAfter: 604_803_000,
      },
    ]);
    await expect(lifecycleStore.listTrash("editor-1")).resolves.toEqual([]);
    await expect(lifecycleStore.restoreWorkspace("editor-1", "workspace-1"))
      .rejects.toMatchObject({ code: "workspace_forbidden" });

    await lifecycleStore.restoreWorkspace("owner-1", "workspace-1");

    await expect(pool.query(
      `SELECT deleted_at, deleted_by, purge_after
       FROM editor_workspaces
       WHERE id = $1`,
      ["workspace-1"],
    )).resolves.toMatchObject({
      rows: [{ deleted_at: null, deleted_by: null, purge_after: null }],
    });
    await expect(pool.query(
      "SELECT selected_workspace_id FROM workspace_preferences WHERE user_id = $1",
      ["owner-1"],
    )).resolves.toMatchObject({ rows: [{ selected_workspace_id: "workspace-1" }] });
    await expect(pool.query(
      "SELECT event_type FROM workspace_audit_events WHERE workspace_id = $1",
      ["workspace-1"],
    )).resolves.toMatchObject({ rows: [{ event_type: "workspace_restored" }] });

    await pool.query(
      `UPDATE editor_workspaces
       SET deleted_at = $1, deleted_by = $2, purge_after = $3
       WHERE id = $4`,
      [-604_797_000, "owner-1", 3_000, "workspace-1"],
    );
    await expect(lifecycleStore.restoreWorkspace("owner-1", "workspace-1"))
      .rejects.toMatchObject({ code: "workspace_purge_expired" });
  });
});

async function seedWorkspace(pool: Pool) {
  const users = [
    ["owner-1", "owner@example.com", "Owner"],
    ["editor-1", "editor@example.com", "Editor"],
    ["viewer-1", "viewer@example.com", "Viewer"],
    ["viewer-2", "viewer2@example.com", "Viewer two"],
  ];
  for (const [id, email, displayName] of users) {
    await pool.query(
      "INSERT INTO app_users (id, email, display_name, created_at) VALUES ($1, $2, $3, $4)",
      [id, email, displayName, 1_000],
    );
  }
  await pool.query(
    `INSERT INTO editor_workspaces (id, name, updated_at, created_at)
     VALUES ($1, $2, $3, $4)`,
    ["workspace-1", "Product centre", 1_000, 1_000],
  );
  for (const [userId, role] of [
    ["owner-1", "owner"],
    ["editor-1", "editor"],
    ["viewer-1", "viewer"],
    ["viewer-2", "viewer"],
  ]) {
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
       VALUES ($1, $2, $3, $4)`,
      ["workspace-1", userId, role, 1_000],
    );
  }
  for (const id of ["document-1", "document-2"]) {
    await pool.query(
      `INSERT INTO editor_documents (workspace_id, id, public_id, created_by, title, position, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ["workspace-1", id, `document-${id}`, "owner-1", id, id === "document-1" ? 0 : 1, 1_000],
    );
  }
  for (const [id, type] of [["block-1", "image"], ["block-2", "file"], ["block-3", "file"]]) {
    await pool.query(
      `INSERT INTO editor_blocks
       (workspace_id, id, document_id, type, content, checked, assignee, due_date, status, parent_id, position, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
      ["workspace-1", id, "document-1", type, "", false, "", "", "unset", null, 0, 1_000],
    );
  }
  await pool.query(
    `INSERT INTO workspace_invites
     (id, workspace_id, email, role, token_hash, status, delivery_status, invited_by, created_at, updated_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', 'sent', $6, $7, $7, $8)`,
    ["invite-pending", "workspace-1", "invitee@example.com", "viewer", "token-hash", "owner-1", 1_000, 4_000],
  );
}
