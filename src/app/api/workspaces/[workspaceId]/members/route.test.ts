import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgMemPool } from "@/test/pgMemDatabase";
import { migrateDatabase } from "@/server/database/migrations";
import { PostgresAuthStore } from "@/server/postgresAuthStore";
import { PostgresWorkspaceMemberStore } from "@/server/postgresWorkspaceMemberStore";
import { PostgresWorkspaceStore } from "@/server/postgresWorkspaceStore";
import { createWorkspaceMemberRouteHandlers } from "./handlers";
import * as memberRoute from "./route";

describe("explicit workspace member route", () => {
  let pool: Pool;
  let authStore: PostgresAuthStore;
  let memberStore: PostgresWorkspaceMemberStore;
  let workspaceStore: PostgresWorkspaceStore;
  let handlers: ReturnType<typeof createWorkspaceMemberRouteHandlers>;

  beforeEach(async () => {
    pool = createPgMemPool();
    await migrateDatabase(pool);
    workspaceStore = new PostgresWorkspaceStore(pool);
    memberStore = new PostgresWorkspaceMemberStore(pool);
    authStore = new PostgresAuthStore(pool, workspaceStore);
    handlers = createWorkspaceMemberRouteHandlers({ authStore, memberStore });
  });

  afterEach(async () => {
    await pool.end();
  });

  it("lists the requested workspace even when it is not selected", async () => {
    const owner = await authStore.createSession({ displayName: "林夏", email: "owner@example.com" });
    const editor = await authStore.createSession({ displayName: "周宁", email: "editor@example.com" });
    const ownerWorkspaceId = (await workspaceStore.listWorkspaces(owner.user.id)).currentWorkspaceId;
    await workspaceStore.createWorkspace(owner.user.id, "当前工作区");
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
       VALUES ($1, $2, 'editor', $3)`,
      [ownerWorkspaceId, editor.user.id, 2000],
    );
    const listResponse = await handlers.GET(
      new Request("http://localhost/api/workspaces/ignored/members", {
        headers: { Cookie: `notion_editor_session=${editor.token}` },
      }),
      ownerWorkspaceId,
    );

    await expect(listResponse.json()).resolves.toEqual({
      members: [
        expect.objectContaining({ email: "owner@example.com", joinedAt: expect.any(Number), role: "owner" }),
        expect.objectContaining({ email: "editor@example.com", joinedAt: 2000, role: "editor" }),
      ],
    });
  });

  it("does not expose direct member creation", () => {
    expect(memberRoute).not.toHaveProperty("POST");
  });

  it("uses PATCH, DELETE, and the dedicated leave route", async () => {
    await expect(
      handlers.PATCH(new Request("http://localhost", { method: "PATCH" }), "workspace/a", "user/b"),
    ).resolves.toBeDefined();
    await expect(
      handlers.DELETE(new Request("http://localhost", { method: "DELETE" }), "workspace/a", "user/b"),
    ).resolves.toBeDefined();
    await expect(
      handlers.leave(new Request("http://localhost", { method: "POST" }), "workspace/a"),
    ).resolves.toBeDefined();
  });

  it("returns 404 for a workspace the user cannot access", async () => {
    const owner = await authStore.createSession({ displayName: "林夏", email: "owner@example.com" });
    const response = await handlers.GET(
      new Request("http://localhost/api/workspaces/missing/members", {
        headers: { Cookie: `notion_editor_session=${owner.token}` },
      }),
      "missing-workspace",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "workspace_not_found",
      error: "Workspace not found",
    });
  });
});
