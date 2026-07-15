import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultWorkspace } from "../../../../features/editor/model/workspaceOperations";
import { migrateDatabase } from "../../../../server/database/migrations";
import { PostgresAuthStore } from "../../../../server/postgresAuthStore";
import { PostgresWorkspaceStore } from "../../../../server/postgresWorkspaceStore";
import { createPgMemPool } from "../../../../test/pgMemDatabase";
import { createWorkspaceRouteHandlers } from "../handlers";

describe("workspace resource route", () => {
  let pool: Pool;
  let authStore: PostgresAuthStore;
  let workspaceStore: PostgresWorkspaceStore;
  let handlers: ReturnType<typeof createWorkspaceRouteHandlers>;

  beforeEach(async () => {
    pool = createPgMemPool();
    await migrateDatabase(pool);
    workspaceStore = new PostgresWorkspaceStore(pool, { now: () => 3000 });
    authStore = new PostgresAuthStore(pool, workspaceStore);
    handlers = createWorkspaceRouteHandlers({ authStore, workspaceStore });
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
    await workspaceStore.addMember(owner.user.id, "editor@example.com", "editor");
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
    await workspaceStore.addMember(owner.user.id, "viewer@example.com", "viewer");
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
});
