import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "../../../../../server/database/migrations";
import { PostgresAuthStore } from "../../../../../server/postgresAuthStore";
import { PostgresWorkspaceStore } from "../../../../../server/postgresWorkspaceStore";
import { createPgMemPool } from "../../../../../test/pgMemDatabase";
import { createWorkspaceRouteHandlers } from "../../handlers";

describe("workspace selection route", () => {
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

  it("returns 404 without changing selection for an inaccessible workspace", async () => {
    const session = await authStore.createSession({ displayName: "Owner", email: "owner@example.com" });
    const selectedBefore = (await workspaceStore.listWorkspaces(session.user.id)).currentWorkspaceId;
    const response = await handlers.select(
      new Request("http://localhost/api/workspaces/missing/select", {
        headers: { Cookie: `notion_editor_session=${session.token}` },
        method: "POST",
      }),
      "missing",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "工作区不存在" });
    expect((await workspaceStore.listWorkspaces(session.user.id)).currentWorkspaceId).toBe(selectedBefore);
  });

  it("persists the selected workspace and returns its snapshot", async () => {
    const session = await authStore.createSession({ displayName: "Owner", email: "owner@example.com" });
    const created = await workspaceStore.createWorkspace(session.user.id, "Second workspace");
    const firstWorkspace = (await workspaceStore.listWorkspaces(session.user.id)).workspaces.find(
      (workspace) => workspace.id !== created.summary.id,
    );
    expect(firstWorkspace).toBeDefined();

    const response = await handlers.select(
      new Request(`http://localhost/api/workspaces/${firstWorkspace!.id}/select`, {
        headers: { Cookie: `notion_editor_session=${session.token}` },
        method: "POST",
      }),
      firstWorkspace!.id,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      summary: { id: firstWorkspace!.id },
    });
    expect((await workspaceStore.listWorkspaces(session.user.id)).currentWorkspaceId).toBe(firstWorkspace!.id);
  });
});
