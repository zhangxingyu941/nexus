import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgMemPool } from "@/test/pgMemDatabase";
import { createDefaultWorkspace, createWorkspaceDocument } from "../../../features/editor/model/workspaceOperations";
import { migrateDatabase } from "../../../server/database/migrations";
import { PostgresAuthStore } from "../../../server/postgresAuthStore";
import { PostgresWorkspaceStore } from "../../../server/postgresWorkspaceStore";
import { createWorkspaceRouteHandlers } from "./handlers";
import { GET, PUT } from "./route";

describe("Next workspace route", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "next-workspace-api-"));
    vi.stubEnv("WORKSPACE_DATA_FILE", join(tempDir, "workspace.json"));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tempDir, { force: true, recursive: true });
  });

  it("returns null before a workspace has been saved", async () => {
    const response = await GET(new Request("http://localhost/api/workspace"));

    await expect(response.json()).resolves.toEqual({ workspace: null });
    expect(response.status).toBe(200);
  });

  it("saves a workspace and returns it on later reads", async () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000, "Next 同步文档");
    const request = new Request("http://localhost/api/workspace", {
      body: JSON.stringify({ workspace }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });

    const saveResponse = await PUT(request);
    const loadResponse = await GET(new Request("http://localhost/api/workspace"));

    await expect(saveResponse.json()).resolves.toEqual({
      saved: true,
      workspace,
    });
    await expect(loadResponse.json()).resolves.toEqual({ workspace });
  });

  it("rejects invalid workspace payloads", async () => {
    const request = new Request("http://localhost/api/workspace", {
      body: JSON.stringify({ workspace: { documents: [] } }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    });

    const response = await PUT(request);

    await expect(response.json()).resolves.toEqual({
      error: "工作区数据格式不正确",
    });
    expect(response.status).toBe(400);
  });
});

describe("database workspace route", () => {
  let pool: Pool;
  let workspaceStore: PostgresWorkspaceStore;
  let authStore: PostgresAuthStore;
  let handlers: ReturnType<typeof createWorkspaceRouteHandlers>;

  beforeEach(async () => {
    pool = createPgMemPool();
    await migrateDatabase(pool);
    workspaceStore = new PostgresWorkspaceStore(pool);
    authStore = new PostgresAuthStore(pool, workspaceStore);
    handlers = createWorkspaceRouteHandlers({ authStore, workspaceStore });
  });

  afterEach(async () => {
    await pool.end();
  });

  it("requires a database session", async () => {
    const response = await handlers.GET(new Request("http://localhost/api/workspace"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "请先进入工作区" });
  });

  it("saves and returns the authenticated user's workspace and role", async () => {
    const session = await authStore.createSession({ displayName: "林夏", email: "owner@example.com" });
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000, "数据库 API 文档");
    const cookie = `notion_editor_session=${session.token}`;

    const saveResponse = await handlers.PUT(
      new Request("http://localhost/api/workspace", {
        body: JSON.stringify({ workspace }),
        headers: { "Content-Type": "application/json", Cookie: cookie },
        method: "PUT",
      }),
    );
    const loadResponse = await handlers.GET(
      new Request("http://localhost/api/workspace", { headers: { Cookie: cookie } }),
    );

    expect(saveResponse.status).toBe(200);
    await expect(loadResponse.json()).resolves.toMatchObject({ role: "owner", workspace });
  });

  it("rejects viewer writes while preserving read access", async () => {
    const ownerSession = await authStore.createSession({ displayName: "林夏", email: "owner@example.com" });
    const viewerSession = await authStore.createSession({ displayName: "访客", email: "viewer@example.com" });
    const workspace = createDefaultWorkspace(1000);
    await workspaceStore.saveWorkspace(ownerSession.user.id, workspace);
    const ownerAccess = await workspaceStore.getWorkspaceAccess(ownerSession.user.id);
    expect(ownerAccess).not.toBeNull();
    await workspaceStore.addMember(
      ownerSession.user.id,
      ownerAccess!.workspaceId,
      "viewer@example.com",
      "viewer",
    );
    await pool.query(
      "UPDATE workspace_preferences SET selected_workspace_id = $1 WHERE user_id = $2",
      [ownerAccess!.workspaceId, viewerSession.user.id],
    );
    const viewerCookie = `notion_editor_session=${viewerSession.token}`;

    const loadResponse = await handlers.GET(
      new Request("http://localhost/api/workspace", { headers: { Cookie: viewerCookie } }),
    );
    const saveResponse = await handlers.PUT(
      new Request("http://localhost/api/workspace", {
        body: JSON.stringify({ workspace }),
        headers: { "Content-Type": "application/json", Cookie: viewerCookie },
        method: "PUT",
      }),
    );

    expect(loadResponse.status).toBe(200);
    await expect(loadResponse.json()).resolves.toMatchObject({ role: "viewer", workspace });
    expect(saveResponse.status).toBe(403);
    await expect(saveResponse.json()).resolves.toEqual({ error: "没有修改此工作区的权限" });
  });
});
