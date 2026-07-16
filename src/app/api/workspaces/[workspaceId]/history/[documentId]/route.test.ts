import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultWorkspace } from "@/features/editor/model/workspaceOperations";
import { createPgMemPool } from "@/test/pgMemDatabase";
import { migrateDatabase } from "@/server/database/migrations";
import { PostgresAuthStore } from "@/server/postgresAuthStore";
import { PostgresWorkspaceStore } from "@/server/postgresWorkspaceStore";
import { createDocumentHistoryRouteHandlers } from "./handlers";

describe("explicit workspace history route", () => {
  let pool: Pool;
  let authStore: PostgresAuthStore;
  let workspaceStore: PostgresWorkspaceStore;
  let handlers: ReturnType<typeof createDocumentHistoryRouteHandlers>;

  beforeEach(async () => {
    let workspaceSequence = 0;
    pool = createPgMemPool();
    await migrateDatabase(pool);
    workspaceStore = new PostgresWorkspaceStore(pool, {
      idFactory: () => `workspace-${++workspaceSequence}`,
      now: () => 3000,
    });
    authStore = new PostgresAuthStore(pool, workspaceStore);
    handlers = createDocumentHistoryRouteHandlers({ authStore, workspaceStore });
  });

  afterEach(async () => {
    await pool.end();
  });

  it("reads a non-selected workspace and rejects a cross-workspace document id", async () => {
    const session = await authStore.createSession({ displayName: "林夏", email: "owner@example.com" });
    const workspaceAId = (await workspaceStore.listWorkspaces(session.user.id)).currentWorkspaceId;
    const workspaceA = createDefaultWorkspace(1000);
    await workspaceStore.saveWorkspace(session.user.id, workspaceAId, workspaceA);
    await workspaceStore.saveWorkspace(session.user.id, workspaceAId, {
      ...workspaceA,
      documents: workspaceA.documents.map((document) => ({ ...document, title: "第二版" })),
      updatedAt: 2000,
    });
    const workspaceB = await workspaceStore.createWorkspace(session.user.id, "工作区 B");
    const request = new Request("http://localhost/api/workspaces/ignored/history/ignored", {
      headers: { Cookie: `notion_editor_session=${session.token}` },
    });

    const listResponse = await handlers.GET(request, workspaceAId, workspaceA.activeDocumentId);
    const mismatchResponse = await handlers.GET(
      request,
      workspaceB.summary.id,
      workspaceA.activeDocumentId,
    );

    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json() as {
      versions: Array<{ title: string }>;
    };
    expect(listPayload.versions).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "第二版" })]),
    );
    expect(mismatchResponse.status).toBe(404);
    await expect(mismatchResponse.json()).resolves.toEqual({ error: "工作区不存在" });
  });
});
