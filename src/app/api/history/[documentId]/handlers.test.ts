import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgMemPool } from "@/test/pgMemDatabase";
import { createDefaultWorkspace } from "../../../../features/editor/model/workspaceOperations";
import { migrateDatabase } from "../../../../server/database/migrations";
import { PostgresAuthStore } from "../../../../server/postgresAuthStore";
import { PostgresWorkspaceStore } from "../../../../server/postgresWorkspaceStore";
import { createDocumentHistoryRouteHandlers } from "./handlers";

describe("document history route", () => {
  let pool: Pool;
  let authStore: PostgresAuthStore;
  let workspaceStore: PostgresWorkspaceStore;
  let handlers: ReturnType<typeof createDocumentHistoryRouteHandlers>;

  beforeEach(async () => {
    pool = createPgMemPool();
    await migrateDatabase(pool);
    workspaceStore = new PostgresWorkspaceStore(pool, { now: () => 3000 });
    authStore = new PostgresAuthStore(pool, workspaceStore, {
      now: () => 1000,
      sessionTokenFactory: () => "history-session-token",
      userIdFactory: () => "history-user",
    });
    handlers = createDocumentHistoryRouteHandlers({ authStore, workspaceStore });
  });

  afterEach(async () => {
    await pool.end();
  });

  it("lists and restores authenticated document versions", async () => {
    const session = await authStore.createSession({ displayName: "林夏", email: "owner@example.com" });
    const workspace = createDefaultWorkspace(1000);
    await workspaceStore.saveWorkspace(session.user.id, workspace);
    await workspaceStore.saveWorkspace(session.user.id, {
      ...workspace,
      documents: workspace.documents.map((document) => ({
        ...document,
        title: "第二版",
        updatedAt: 2000,
      })),
      updatedAt: 2000,
    });
    const request = new Request("http://localhost/api/history/document-1000", {
      headers: { Cookie: `notion_editor_session=${session.token}` },
    });

    const listResponse = await handlers.GET(request, workspace.activeDocumentId);
    const listPayload = await listResponse.json() as { versions: Array<{ id: string; title: string }> };

    expect(listResponse.status).toBe(200);
    expect(listPayload.versions.map((version) => version.title)).toEqual(["第二版", "未命名文档"]);

    const restoreResponse = await handlers.POST(
      new Request("http://localhost/api/history/document-1000", {
        body: JSON.stringify({ versionId: listPayload.versions[1].id }),
        headers: {
          "Content-Type": "application/json",
          Cookie: `notion_editor_session=${session.token}`,
        },
        method: "POST",
      }),
      workspace.activeDocumentId,
    );

    expect(restoreResponse.status).toBe(200);
    await expect(restoreResponse.json()).resolves.toMatchObject({
      document: { title: "未命名文档" },
      restored: true,
    });
  });

  it("requires a session and validates restore input", async () => {
    const unauthorizedResponse = await handlers.GET(
      new Request("http://localhost/api/history/document-1"),
      "document-1",
    );

    expect(unauthorizedResponse.status).toBe(401);

    const session = await authStore.createSession({ displayName: "林夏", email: "owner@example.com" });
    const invalidResponse = await handlers.POST(
      new Request("http://localhost/api/history/document-1", {
        body: JSON.stringify({}),
        headers: {
          "Content-Type": "application/json",
          Cookie: `notion_editor_session=${session.token}`,
        },
        method: "POST",
      }),
      "document-1",
    );

    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toEqual({ error: "版本标识不正确" });
  });
});
