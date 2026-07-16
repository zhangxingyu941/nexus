import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgMemPool } from "@/test/pgMemDatabase";
import { migrateDatabase } from "@/server/database/migrations";
import { PostgresAuthStore } from "@/server/postgresAuthStore";
import { PostgresWorkspaceStore } from "@/server/postgresWorkspaceStore";
import { createWorkspaceMemberRouteHandlers } from "./handlers";

describe("explicit workspace member route", () => {
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

  it("manages the requested workspace even when it is not selected", async () => {
    const owner = await authStore.createSession({ displayName: "林夏", email: "owner@example.com" });
    await authStore.createSession({ displayName: "周宁", email: "editor@example.com" });
    const ownerWorkspaceId = (await workspaceStore.listWorkspaces(owner.user.id)).currentWorkspaceId;
    await workspaceStore.createWorkspace(owner.user.id, "当前工作区");
    const cookie = `notion_editor_session=${owner.token}`;

    const addResponse = await handlers.POST(
      new Request("http://localhost/api/workspaces/ignored/members", {
        body: JSON.stringify({ email: "editor@example.com", role: "editor" }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "POST",
      }),
      ownerWorkspaceId,
    );
    const listResponse = await handlers.GET(
      new Request("http://localhost/api/workspaces/ignored/members", {
        headers: { Cookie: cookie },
      }),
      ownerWorkspaceId,
    );

    expect(addResponse.status).toBe(201);
    await expect(listResponse.json()).resolves.toEqual({
      members: [
        expect.objectContaining({ email: "owner@example.com", role: "owner" }),
        expect.objectContaining({ email: "editor@example.com", role: "editor" }),
      ],
    });
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
    await expect(response.json()).resolves.toEqual({ error: "工作区不存在" });
  });
});
