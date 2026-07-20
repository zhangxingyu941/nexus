import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultWorkspace } from "../../../../features/editor/model/workspaceOperations";
import { migrateDatabase } from "../../../../server/database/migrations";
import { PostgresAuthStore } from "../../../../server/postgresAuthStore";
import { PostgresWorkspaceLifecycleStore } from "../../../../server/postgresWorkspaceLifecycleStore";
import { PostgresWorkspaceStore } from "../../../../server/postgresWorkspaceStore";
import { createPgMemPool } from "../../../../test/pgMemDatabase";
import { createWorkspaceRouteHandlers } from "../handlers";
import { createWorkspaceLifecycleRouteHandlers } from "../lifecycleHandlers";

describe("workspace resource route", () => {
  let pool: Pool;
  let authStore: PostgresAuthStore;
  let lifecycleStore: PostgresWorkspaceLifecycleStore;
  let workspaceStore: PostgresWorkspaceStore;
  let handlers: ReturnType<typeof createWorkspaceRouteHandlers>;
  let lifecycleHandlers: ReturnType<typeof createWorkspaceLifecycleRouteHandlers>;

  beforeEach(async () => {
    pool = createPgMemPool();
    await migrateDatabase(pool);
    workspaceStore = new PostgresWorkspaceStore(pool, { now: () => 3000 });
    lifecycleStore = new PostgresWorkspaceLifecycleStore(pool, {
      now: () => 3000,
      notifyAccessInvalidation: async () => undefined,
    });
    authStore = new PostgresAuthStore(pool, workspaceStore);
    handlers = createWorkspaceRouteHandlers({ authStore, workspaceStore });
    lifecycleHandlers = createWorkspaceLifecycleRouteHandlers({
      authStore,
      lifecycleStore,
      workspaceStore,
    });
  });

  afterEach(async () => {
    await pool.end();
  });

  it("returns 404 for a workspace the user cannot access", async () => {
    const session = await authStore.createSession({ displayName: "Owner", email: "owner@example.com" });
    const response = await handlers.load(
      new Request("http://localhost/api/workspaces/missing", {
        headers: { Cookie: `notion_editor_session=${session.token}` },
      }),
      "missing",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "工作区不存在" });
  });

  it("rejects editor renames with 403", async () => {
    const owner = await authStore.createSession({ displayName: "Owner", email: "owner@example.com" });
    const editor = await authStore.createSession({ displayName: "Editor", email: "editor@example.com" });
    const workspaceId = (await workspaceStore.listWorkspaces(owner.user.id)).currentWorkspaceId;
    await seedMembership(pool, workspaceId, editor.user.id, "editor");
    const response = await handlers.rename(
      new Request(`http://localhost/api/workspaces/${workspaceId}`, {
        body: JSON.stringify({ name: "越权名称" }),
        headers: {
          Cookie: `notion_editor_session=${editor.token}`,
          "Content-Type": "application/json",
        },
        method: "PATCH",
      }),
      workspaceId,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "只有工作区所有者可以重命名" });
  });

  it("renames an owner workspace and saves explicitly scoped content", async () => {
    const owner = await authStore.createSession({ displayName: "Owner", email: "owner@example.com" });
    const workspaceId = (await workspaceStore.listWorkspaces(owner.user.id)).currentWorkspaceId;
    const renameResponse = await handlers.rename(
      new Request(`http://localhost/api/workspaces/${workspaceId}`, {
        body: JSON.stringify({ name: "研发中心" }),
        headers: {
          Cookie: `notion_editor_session=${owner.token}`,
          "Content-Type": "application/json",
        },
        method: "PATCH",
      }),
      workspaceId,
    );
    const content = createDefaultWorkspace(5000);
    const saveResponse = await handlers.save(
      new Request(`http://localhost/api/workspaces/${workspaceId}`, {
        body: JSON.stringify({ content }),
        headers: {
          Cookie: `notion_editor_session=${owner.token}`,
          "Content-Type": "application/json",
        },
        method: "PUT",
      }),
      workspaceId,
    );
    const loadResponse = await handlers.load(
      new Request(`http://localhost/api/workspaces/${workspaceId}`, {
        headers: { Cookie: `notion_editor_session=${owner.token}` },
      }),
      workspaceId,
    );

    expect(renameResponse.status).toBe(200);
    await expect(renameResponse.json()).resolves.toMatchObject({
      workspace: { id: workspaceId, name: "研发中心" },
    });
    expect(saveResponse.status).toBe(200);
    await expect(saveResponse.json()).resolves.toEqual({ saved: true });
    await expect(loadResponse.json()).resolves.toMatchObject({
      content,
      summary: { id: workspaceId, name: "研发中心" },
    });
  });

  it("rejects viewer saves and invalid content", async () => {
    const owner = await authStore.createSession({ displayName: "Owner", email: "owner@example.com" });
    const viewer = await authStore.createSession({ displayName: "Viewer", email: "viewer@example.com" });
    const workspaceId = (await workspaceStore.listWorkspaces(owner.user.id)).currentWorkspaceId;
    await seedMembership(pool, workspaceId, viewer.user.id, "viewer");
    const viewerResponse = await handlers.save(
      new Request(`http://localhost/api/workspaces/${workspaceId}`, {
        body: JSON.stringify({ content: createDefaultWorkspace(5000) }),
        headers: {
          Cookie: `notion_editor_session=${viewer.token}`,
          "Content-Type": "application/json",
        },
        method: "PUT",
      }),
      workspaceId,
    );
    const invalidResponse = await handlers.save(
      new Request(`http://localhost/api/workspaces/${workspaceId}`, {
        body: JSON.stringify({ content: { documents: [] } }),
        headers: {
          Cookie: `notion_editor_session=${owner.token}`,
          "Content-Type": "application/json",
        },
        method: "PUT",
      }),
      workspaceId,
    );

    expect(viewerResponse.status).toBe(403);
    await expect(viewerResponse.json()).resolves.toEqual({ error: "没有修改此工作区的权限" });
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toEqual({ error: "工作区数据格式不正确" });
  });

  it("deletes a workspace and returns the catalog with an active fallback snapshot", async () => {
    const owner = await authStore.createSession({ displayName: "Owner", email: "owner@example.com" });
    const workspaceId = (await workspaceStore.listWorkspaces(owner.user.id)).currentWorkspaceId;
    const deletedWorkspace = await workspaceStore.loadWorkspace(owner.user.id, workspaceId);
    await workspaceStore.createWorkspace(owner.user.id, "Fallback");
    const response = await lifecycleHandlers.DELETE(
      new Request(`http://localhost/api/workspaces/${workspaceId}`, {
        body: JSON.stringify({ confirmationName: deletedWorkspace.summary.name }),
        headers: {
          Cookie: `notion_editor_session=${owner.token}`,
          "Content-Type": "application/json",
        },
        method: "DELETE",
      }),
      workspaceId,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      catalog: {
        currentWorkspaceId: expect.not.stringMatching(new RegExp(`^${workspaceId}$`)),
        workspaces: [expect.objectContaining({ name: "Fallback" })],
      },
      deletedWorkspace: { id: workspaceId, name: deletedWorkspace.summary.name },
      workspace: { summary: { name: "Fallback" } },
    });
  });

  it("restores a tombstone and returns its selected catalog transition", async () => {
    const owner = await authStore.createSession({ displayName: "Owner", email: "owner@example.com" });
    const workspaceId = (await workspaceStore.listWorkspaces(owner.user.id)).currentWorkspaceId;
    const deletedWorkspace = await workspaceStore.loadWorkspace(owner.user.id, workspaceId);
    await lifecycleStore.deleteWorkspace({
      actorUserId: owner.user.id,
      confirmationName: deletedWorkspace.summary.name,
      workspaceId,
    });

    const response = await lifecycleHandlers.restore(
      new Request(`http://localhost/api/workspaces/${workspaceId}/restore`, {
        headers: { Cookie: `notion_editor_session=${owner.token}` },
        method: "POST",
      }),
      workspaceId,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      catalog: { currentWorkspaceId: workspaceId },
      workspace: { summary: { id: workspaceId, name: deletedWorkspace.summary.name } },
    });
  });
});

async function seedMembership(
  pool: Pool,
  workspaceId: string,
  userId: string,
  role: "editor" | "viewer",
) {
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
     VALUES ($1, $2, $3, $4)`,
    [workspaceId, userId, role, 3000],
  );
}
