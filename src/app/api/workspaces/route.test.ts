import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "../../../server/database/migrations";
import { createPostgresServices } from "../../../server/applicationServices";
import { PostgresAuthStore } from "../../../server/postgresAuthStore";
import { PostgresWorkspaceStore } from "../../../server/postgresWorkspaceStore";
import { createPgMemPool } from "../../../test/pgMemDatabase";
import { createWorkspaceRouteHandlers } from "./handlers";
import { scheduleWorkspacePurge } from "./purgeScheduler";
import { GET } from "./route";

vi.mock("./purgeScheduler", () => ({
  scheduleWorkspacePurge: vi.fn(),
}));

vi.mock("../../../server/applicationServices", () => ({
  createPostgresServices: vi.fn(),
}));

describe("workspace catalog route", () => {
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
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    await pool.end();
  });

  it("returns 503 when PostgreSQL mode is unavailable", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const response = await GET(new Request("http://localhost/api/workspaces"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "当前未启用 PostgreSQL 模式" });
  });

  it("requires an authenticated session", async () => {
    const response = await handlers.list(new Request("http://localhost/api/workspaces"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "请先进入工作区" });
  });

  it("rejects malformed JSON and invalid workspace names", async () => {
    const session = await authStore.createSession({ displayName: "Owner", email: "owner@example.com" });
    const cookie = `notion_editor_session=${session.token}`;
    const malformedResponse = await handlers.create(new Request("http://localhost/api/workspaces", {
      body: "{",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      method: "POST",
    }));
    const invalidNameResponse = await handlers.create(new Request("http://localhost/api/workspaces", {
      body: JSON.stringify({ name: "   " }),
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      method: "POST",
    }));

    expect(malformedResponse.status).toBe(400);
    await expect(malformedResponse.json()).resolves.toEqual({ error: "请求 JSON 格式不正确" });
    expect(invalidNameResponse.status).toBe(400);
    await expect(invalidNameResponse.json()).resolves.toEqual({
      error: "工作区名称长度必须为 1-80 个字符",
    });
  });

  it("creates, selects, and lists a workspace", async () => {
    const session = await authStore.createSession({ displayName: "Owner", email: "owner@example.com" });
    const cookie = `notion_editor_session=${session.token}`;
    const createResponse = await handlers.create(new Request("http://localhost/api/workspaces", {
      body: JSON.stringify({ name: "  产品团队  " }),
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      method: "POST",
    }));
    const created = await createResponse.json();
    const listResponse = await handlers.list(new Request("http://localhost/api/workspaces", {
      headers: { Cookie: cookie },
    }));
    const catalog = await listResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created).toMatchObject({
      content: { documents: [expect.objectContaining({ title: "未命名文档" })] },
      summary: { name: "产品团队", role: "owner" },
    });
    expect(listResponse.status).toBe(200);
    expect(catalog.currentWorkspaceId).toBe(created.summary.id);
    expect(catalog.workspaces).toHaveLength(2);
    expect(catalog.workspaces[0]).toMatchObject({ id: created.summary.id, name: "产品团队" });
  });

  it("schedules an expired workspace purge after the catalog response", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://example.test/workspaces");
    const purgeExpired = vi.fn().mockResolvedValue(undefined);

    vi.mocked(createPostgresServices).mockReturnValue({
      authStore: { getUserBySessionToken: vi.fn().mockResolvedValue(null) },
      workspacePurgeService: { purgeExpired },
      workspaceStore: {},
    } as never);

    await GET(new Request("http://localhost/api/workspaces"));

    expect(scheduleWorkspacePurge).toHaveBeenCalledWith(expect.any(Function));
    const purge = vi.mocked(scheduleWorkspacePurge).mock.calls[0]?.[0];
    await purge?.();
    expect(purgeExpired).toHaveBeenCalledWith(3);
  });
});
