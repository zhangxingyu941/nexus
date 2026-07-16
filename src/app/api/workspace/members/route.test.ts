import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgMemPool } from "@/test/pgMemDatabase";
import { migrateDatabase } from "../../../../server/database/migrations";
import { PostgresAuthStore } from "../../../../server/postgresAuthStore";
import { PostgresWorkspaceStore } from "../../../../server/postgresWorkspaceStore";
import { createWorkspaceMemberRouteHandlers } from "./handlers";

describe("workspace member route", () => {
  let pool: Pool;
  let authStore: PostgresAuthStore;
  let workspaceStore: PostgresWorkspaceStore;
  let handlers: ReturnType<typeof createWorkspaceMemberRouteHandlers>;

  beforeEach(async () => {
    pool = createPgMemPool();
    await migrateDatabase(pool);
    workspaceStore = new PostgresWorkspaceStore(pool);
    authStore = new PostgresAuthStore(pool, workspaceStore);
    handlers = createWorkspaceMemberRouteHandlers({ authStore, workspaceStore });
  });

  afterEach(async () => {
    await pool.end();
  });

  it("lets owners grant a role and returns persisted members", async () => {
    const owner = await authStore.createSession({ displayName: "林夏", email: "owner@example.com" });
    await authStore.createSession({ displayName: "周宁", email: "editor@example.com" });
    const cookie = `notion_editor_session=${owner.token}`;

    const addResponse = await handlers.POST(
      new Request("http://localhost/api/workspace/members", {
        body: JSON.stringify({ email: "editor@example.com", role: "editor" }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "POST",
      }),
    );
    const listResponse = await handlers.GET(
      new Request("http://localhost/api/workspace/members", { headers: { Cookie: cookie } }),
    );

    expect(addResponse.status).toBe(201);
    await expect(listResponse.json()).resolves.toEqual({
      members: [
        expect.objectContaining({ email: "owner@example.com", role: "owner" }),
        expect.objectContaining({ email: "editor@example.com", role: "editor" }),
      ],
    });
  });

  it("rejects member management from non-owners", async () => {
    const owner = await authStore.createSession({ displayName: "林夏", email: "owner@example.com" });
    const editor = await authStore.createSession({ displayName: "周宁", email: "editor@example.com" });
    const workspaceId = (await workspaceStore.listWorkspaces(owner.user.id)).currentWorkspaceId;
    await workspaceStore.addMember(owner.user.id, workspaceId, "editor@example.com", "editor");
    const ownerAccess = await workspaceStore.getWorkspaceAccess(owner.user.id);
    expect(ownerAccess).not.toBeNull();
    await pool.query(
      "UPDATE workspace_preferences SET selected_workspace_id = $1 WHERE user_id = $2",
      [ownerAccess!.workspaceId, editor.user.id],
    );

    const response = await handlers.POST(
      new Request("http://localhost/api/workspace/members", {
        body: JSON.stringify({ email: "missing@example.com", role: "viewer" }),
        headers: {
          "Content-Type": "application/json",
          Cookie: `notion_editor_session=${editor.token}`,
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "只有工作区所有者可以管理成员" });
  });

  it("validates roles and reports unknown identities", async () => {
    const owner = await authStore.createSession({ displayName: "林夏", email: "owner@example.com" });
    const cookie = `notion_editor_session=${owner.token}`;

    const invalidRole = await handlers.POST(
      new Request("http://localhost/api/workspace/members", {
        body: JSON.stringify({ email: "member@example.com", role: "owner" }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "POST",
      }),
    );
    const missingUser = await handlers.POST(
      new Request("http://localhost/api/workspace/members", {
        body: JSON.stringify({ email: "missing@example.com", role: "viewer" }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "POST",
      }),
    );

    expect(invalidRole.status).toBe(400);
    expect(missingUser.status).toBe(404);
  });
});
