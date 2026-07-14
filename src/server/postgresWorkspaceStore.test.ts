import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultWorkspace, createWorkspaceDocument } from "../features/editor/model/workspaceOperations";
import { migrateDatabase } from "./database/migrations";
import {
  PostgresWorkspaceStore,
  WorkspacePermissionError,
} from "./postgresWorkspaceStore";

describe("PostgresWorkspaceStore", () => {
  let pool: Pool;
  let store: PostgresWorkspaceStore;

  beforeEach(async () => {
    const memoryDatabase = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = memoryDatabase.adapters.createPg();
    pool = new adapter.Pool() as Pool;
    await migrateDatabase(pool);
    store = new PostgresWorkspaceStore(pool, {
      idFactory: () => "workspace-test",
      now: () => 3000,
    });
  });

  afterEach(async () => {
    await pool.end();
  });

  it("provisions one persisted blank document for a new personal workspace", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "林夏");

    await store.ensurePersonalWorkspace("owner-1", "林夏的工作区");
    await store.ensurePersonalWorkspace("owner-1", "林夏的工作区");

    await expect(store.loadWorkspace("owner-1")).resolves.toMatchObject({
      role: "owner",
      workspace: {
        documents: [
          {
            blocks: [expect.objectContaining({ content: "", type: "paragraph" })],
            title: "未命名文档",
          },
        ],
      },
    });
    expect(await countRows(pool, "editor_documents")).toBe(1);
    expect(await countRows(pool, "editor_blocks")).toBe(1);
  });

  it("persists and restores a normalized workspace without losing block data", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "林夏");
    await store.ensurePersonalWorkspace("owner-1", "林夏的工作区");
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000, "数据库文档");
    workspace.documents[0].blocks[0] = {
      ...workspace.documents[0].blocks[0],
      data: {
        kind: "table",
        columns: [{ id: "name", name: "名称" }],
        rows: [{ id: "row-1", cells: { name: "数据库路线图" } }],
      },
      type: "table",
    };
    workspace.documents[0].blocks[0].comments = [
      {
        author: "林夏",
        body: "数据库评论",
        createdAt: 1500,
        id: "comment-database-test",
        resolved: false,
        time: "刚刚",
      },
    ];

    const saved = await store.saveWorkspace("owner-1", workspace);
    const loaded = await store.loadWorkspace("owner-1");

    expect(saved).toEqual(workspace);
    expect(loaded).toEqual({
      role: "owner",
      workspace,
      workspaceId: "workspace-test",
    });

    const tableCounts = await Promise.all([
      countRows(pool, "editor_documents"),
      countRows(pool, "editor_blocks"),
      countRows(pool, "block_comments"),
    ]);
    expect(tableCounts[0]).toBe(workspace.documents.length);
    expect(tableCounts[1]).toBe(workspace.documents.reduce((total, document) => total + document.blocks.length, 0));
    expect(tableCounts[2]).toBeGreaterThan(0);
  });

  it("replaces removed documents and blocks in the same transaction", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "林夏");
    await store.ensurePersonalWorkspace("owner-1", "林夏的工作区");
    const initialWorkspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000, "待删除文档");
    await store.saveWorkspace("owner-1", initialWorkspace);

    const remainingDocument = initialWorkspace.documents[0];
    const nextWorkspace = {
      activeDocumentId: remainingDocument.id,
      documents: [{ ...remainingDocument, blocks: remainingDocument.blocks.slice(0, 2) }],
      updatedAt: 4000,
    };

    await store.saveWorkspace("owner-1", nextWorkspace);

    expect(await store.loadWorkspace("owner-1")).toMatchObject({ workspace: nextWorkspace });
    expect(await countRows(pool, "editor_documents")).toBe(1);
    expect(await countRows(pool, "editor_blocks")).toBe(nextWorkspace.documents[0].blocks.length);
  });

  it("allows viewers to read but rejects workspace writes", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "林夏");
    await seedUser(pool, "viewer-1", "viewer@example.com", "访客");
    await store.ensurePersonalWorkspace("owner-1", "林夏的工作区");
    const workspace = createDefaultWorkspace(1000);
    await store.saveWorkspace("owner-1", workspace);
    await store.addMember("owner-1", "viewer@example.com", "viewer");

    await expect(store.loadWorkspace("viewer-1")).resolves.toMatchObject({
      role: "viewer",
      workspace,
    });
    await expect(store.saveWorkspace("viewer-1", workspace)).rejects.toBeInstanceOf(WorkspacePermissionError);
  });

  it("lets owners grant editor access and lists real workspace members", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "林夏");
    await seedUser(pool, "editor-1", "editor@example.com", "周宁");
    await store.ensurePersonalWorkspace("owner-1", "团队知识库");

    await store.addMember("owner-1", "editor@example.com", "editor");
    const members = await store.listMembers("owner-1");

    expect(members).toEqual([
      expect.objectContaining({ displayName: "林夏", email: "owner@example.com", role: "owner" }),
      expect.objectContaining({ displayName: "周宁", email: "editor@example.com", role: "editor" }),
    ]);
    await expect(store.saveWorkspace("editor-1", createDefaultWorkspace(5000))).resolves.toBeDefined();
  });

  it("resolves document-specific workspace access for collaboration", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "林夏");
    await seedUser(pool, "editor-1", "editor@example.com", "周宁");
    await store.ensurePersonalWorkspace("owner-1", "团队知识库");
    const workspace = createDefaultWorkspace(1000);
    await store.saveWorkspace("owner-1", workspace);
    await store.addMember("owner-1", "editor@example.com", "editor");

    await expect(store.getDocumentAccess("editor-1", workspace.activeDocumentId)).resolves.toEqual({
      role: "editor",
      workspaceId: "workspace-test",
    });
    await expect(store.getDocumentAccess("editor-1", "missing-document")).resolves.toBeNull();
  });

  it("isolates identical document and block ids across different workspaces", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "林夏");
    await seedUser(pool, "owner-2", "second@example.com", "周宁");
    let workspaceSequence = 0;
    const isolatedStore = new PostgresWorkspaceStore(pool, {
      idFactory: () => `isolated-workspace-${++workspaceSequence}`,
      now: () => 3000 + workspaceSequence,
    });
    await isolatedStore.ensurePersonalWorkspace("owner-1", "工作区一");
    await isolatedStore.ensurePersonalWorkspace("owner-2", "工作区二");
    const sharedIdsWorkspace = createDefaultWorkspace(1000);

    await isolatedStore.saveWorkspace("owner-1", sharedIdsWorkspace);
    await isolatedStore.saveWorkspace("owner-2", {
      ...sharedIdsWorkspace,
      documents: sharedIdsWorkspace.documents.map((document) => ({ ...document, title: "第二个工作区" })),
      updatedAt: 2000,
    });

    await expect(isolatedStore.loadWorkspace("owner-1")).resolves.toMatchObject({
      workspace: { documents: [expect.objectContaining({ title: "未命名文档" })] },
    });
    await expect(isolatedStore.loadWorkspace("owner-2")).resolves.toMatchObject({
      workspace: { documents: [expect.objectContaining({ title: "第二个工作区" })] },
    });
  });

  it("stores deduplicated document versions and restores an earlier snapshot", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "林夏");
    await store.ensurePersonalWorkspace("owner-1", "林夏的工作区");
    const initialWorkspace = createDefaultWorkspace(1000);
    const documentId = initialWorkspace.activeDocumentId;

    await store.saveWorkspace("owner-1", initialWorkspace);
    await store.saveWorkspace("owner-1", initialWorkspace);

    const changedWorkspace = {
      ...initialWorkspace,
      documents: initialWorkspace.documents.map((document) => ({
        ...document,
        blocks: document.blocks.map((block, index) =>
          index === 0 ? { ...block, content: "第二版正文", updatedAt: 2000 } : block,
        ),
        title: "第二版标题",
        updatedAt: 2000,
      })),
      updatedAt: 2000,
    };
    await store.saveWorkspace("owner-1", changedWorkspace);

    const versions = await store.listDocumentVersions("owner-1", documentId);

    expect(versions).toHaveLength(2);
    expect(versions.map((version) => version.title)).toEqual(["第二版标题", "未命名文档"]);

    const restored = await store.restoreDocumentVersion(
      "owner-1",
      documentId,
      versions[1].id,
    );

    expect(restored.title).toBe("未命名文档");
    await expect(store.loadWorkspace("owner-1")).resolves.toMatchObject({
      workspace: {
        documents: [expect.objectContaining({ title: "未命名文档" })],
      },
    });
  });

  it("allows viewers to list versions but rejects restoring them", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "林夏");
    await seedUser(pool, "viewer-1", "viewer@example.com", "访客");
    await store.ensurePersonalWorkspace("owner-1", "林夏的工作区");
    const workspace = createDefaultWorkspace(1000);
    await store.saveWorkspace("owner-1", workspace);
    await store.addMember("owner-1", "viewer@example.com", "viewer");
    const versions = await store.listDocumentVersions("viewer-1", workspace.activeDocumentId);

    expect(versions).toHaveLength(1);
    await expect(
      store.restoreDocumentVersion("viewer-1", workspace.activeDocumentId, versions[0].id),
    ).rejects.toBeInstanceOf(WorkspacePermissionError);
  });
});

async function seedUser(pool: Pool, id: string, email: string, displayName: string) {
  await pool.query(
    "INSERT INTO app_users (id, email, display_name, created_at) VALUES ($1, $2, $3, $4)",
    [id, email, displayName, 1000],
  );
}

async function countRows(pool: Pool, table: string) {
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
  return Number(result.rows[0].count);
}
