import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultWorkspace, createWorkspaceDocument } from "../features/editor/model/workspaceOperations";
import { createPgMemPool } from "../test/pgMemDatabase";
import { migrateDatabase } from "./database/migrations";
import {
  PostgresWorkspaceStore,
  WorkspaceNotFoundError,
  WorkspacePermissionError,
} from "./postgresWorkspaceStore";

describe("PostgresWorkspaceStore", () => {
  let pool: Pool;
  let store: PostgresWorkspaceStore;

  beforeEach(async () => {
    pool = createPgMemPool();
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

    await expect(store.loadWorkspace("owner-1", "workspace-test")).resolves.toMatchObject({
      summary: { role: "owner" },
      content: {
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

  it("lists every accessible workspace with the selected workspace first", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "Owner");
    await seedUser(pool, "owner-2", "second@example.com", "Second owner");
    let workspaceSequence = 0;
    const multiWorkspaceStore = new PostgresWorkspaceStore(pool, {
      idFactory: () => `workspace-${++workspaceSequence}`,
      now: () => 3000 + workspaceSequence,
    });
    await multiWorkspaceStore.ensurePersonalWorkspace("owner-1", "Owner workspace");
    await multiWorkspaceStore.ensurePersonalWorkspace("owner-2", "Second workspace");
    await multiWorkspaceStore.addMember("owner-2", "workspace-2", "owner@example.com", "editor");

    await expect(multiWorkspaceStore.listWorkspaces("owner-1")).resolves.toEqual({
      currentWorkspaceId: "workspace-1",
      workspaces: [
        expect.objectContaining({ id: "workspace-1", name: "Owner workspace", role: "owner" }),
        expect.objectContaining({ id: "workspace-2", name: "Second workspace", role: "editor" }),
      ],
    });
  });

  it("creates, selects, and renames explicitly scoped workspaces", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "Owner");
    await seedUser(pool, "editor-1", "editor@example.com", "Editor");
    let workspaceSequence = 0;
    const multiWorkspaceStore = new PostgresWorkspaceStore(pool, {
      idFactory: () => `workspace-${++workspaceSequence}`,
      now: () => 3000 + workspaceSequence,
    });
    await multiWorkspaceStore.ensurePersonalWorkspace("owner-1", "Owner workspace");
    await multiWorkspaceStore.ensurePersonalWorkspace("editor-1", "Editor workspace");

    const created = await multiWorkspaceStore.createWorkspace("owner-1", "  产品团队  ");
    expect(created.summary).toMatchObject({
      id: "workspace-3",
      name: "产品团队",
      role: "owner",
    });
    expect(created.content.documents).toHaveLength(1);
    expect((await multiWorkspaceStore.listWorkspaces("owner-1")).currentWorkspaceId).toBe("workspace-3");

    await multiWorkspaceStore.addMember("owner-1", "workspace-3", "editor@example.com", "editor");
    await expect(
      multiWorkspaceStore.renameWorkspace("editor-1", "workspace-3", "越权名称"),
    ).rejects.toBeInstanceOf(WorkspacePermissionError);

    await expect(
      multiWorkspaceStore.renameWorkspace("owner-1", "workspace-3", "研发中心"),
    ).resolves.toMatchObject({ id: "workspace-3", name: "研发中心", role: "owner" });
    await expect(
      multiWorkspaceStore.selectWorkspace("owner-1", "workspace-1"),
    ).resolves.toMatchObject({ summary: { id: "workspace-1" } });
    expect((await multiWorkspaceStore.listWorkspaces("owner-1")).currentWorkspaceId).toBe("workspace-1");
    await expect(
      multiWorkspaceStore.loadWorkspace("owner-1", "missing-workspace"),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it("loads a separate active document preference for each workspace member", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "Owner");
    await seedUser(pool, "editor-1", "editor@example.com", "Editor");
    await store.ensurePersonalWorkspace("owner-1", "Shared workspace");
    const workspace = createWorkspaceDocument(
      createDefaultWorkspace(1000),
      2000,
      "Second document",
    );
    workspace.activeDocumentId = workspace.documents[0].id;
    await store.saveWorkspace("owner-1", "workspace-test", workspace);
    await store.addMember("owner-1", "workspace-test", "editor@example.com", "editor");
    await store.loadWorkspace("editor-1", "workspace-test");
    await pool.query(
      `UPDATE workspace_document_preferences
       SET active_document_id = $1
       WHERE user_id = $2 AND workspace_id = $3`,
      [workspace.documents[1].id, "editor-1", "workspace-test"],
    );

    await expect(store.loadWorkspace("owner-1", "workspace-test")).resolves.toMatchObject({
      content: { activeDocumentId: workspace.documents[0].id },
      summary: { id: "workspace-test", role: "owner" },
    });
    await expect(store.loadWorkspace("editor-1", "workspace-test")).resolves.toMatchObject({
      content: { activeDocumentId: workspace.documents[1].id },
      summary: { id: "workspace-test", role: "editor" },
    });
  });

  it("saves only the explicitly requested workspace without changing the selection", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "Owner");
    await seedUser(pool, "owner-2", "second@example.com", "Second owner");
    let workspaceSequence = 0;
    const multiWorkspaceStore = new PostgresWorkspaceStore(pool, {
      idFactory: () => `workspace-${++workspaceSequence}`,
      now: () => 3000 + workspaceSequence,
    });
    await multiWorkspaceStore.ensurePersonalWorkspace("owner-1", "Owner workspace");
    await multiWorkspaceStore.ensurePersonalWorkspace("owner-2", "Second workspace");
    await multiWorkspaceStore.addMember("owner-2", "workspace-2", "owner@example.com", "editor");
    const secondWorkspace = await multiWorkspaceStore.loadWorkspace("owner-1", "workspace-2");
    const updatedContent = {
      ...secondWorkspace.content,
      documents: secondWorkspace.content.documents.map((document) => ({
        ...document,
        title: "Updated second workspace",
      })),
      updatedAt: 5000,
    };

    await multiWorkspaceStore.saveWorkspace("owner-1", "workspace-2", updatedContent);

    await expect(multiWorkspaceStore.loadWorkspace("owner-1", "workspace-1")).resolves.toMatchObject({
      content: { documents: [expect.objectContaining({ title: "未命名文档" })] },
    });
    await expect(multiWorkspaceStore.loadWorkspace("owner-1", "workspace-2")).resolves.toMatchObject({
      content: { documents: [expect.objectContaining({ title: "Updated second workspace" })] },
    });
    expect((await multiWorkspaceStore.listWorkspaces("owner-1")).currentWorkspaceId).toBe("workspace-1");
  });

  it("resolves access only when the explicit workspace and document both match", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "Owner");
    await seedUser(pool, "owner-2", "second@example.com", "Second owner");
    let workspaceSequence = 0;
    const multiWorkspaceStore = new PostgresWorkspaceStore(pool, {
      idFactory: () => `workspace-${++workspaceSequence}`,
      now: () => 3000 + workspaceSequence,
    });
    await multiWorkspaceStore.ensurePersonalWorkspace("owner-1", "Owner workspace");
    await multiWorkspaceStore.ensurePersonalWorkspace("owner-2", "Second workspace");
    await multiWorkspaceStore.addMember("owner-2", "workspace-2", "owner@example.com", "editor");
    const secondWorkspace = await multiWorkspaceStore.loadWorkspace("owner-1", "workspace-2");
    const secondDocumentId = secondWorkspace.content.activeDocumentId;

    await expect(multiWorkspaceStore.getWorkspaceAccess("owner-1", "workspace-1")).resolves.toEqual({
      role: "owner",
      workspaceId: "workspace-1",
    });
    await expect(multiWorkspaceStore.getWorkspaceAccess("owner-1", "workspace-2")).resolves.toEqual({
      role: "editor",
      workspaceId: "workspace-2",
    });
    await expect(multiWorkspaceStore.getWorkspaceAccess("owner-1", "missing-workspace")).resolves.toBeNull();
    await expect(
      multiWorkspaceStore.getDocumentAccess("owner-1", "workspace-2", secondDocumentId),
    ).resolves.toEqual({ role: "editor", workspaceId: "workspace-2" });
    await expect(
      multiWorkspaceStore.getDocumentAccess("owner-1", "workspace-1", secondDocumentId),
    ).resolves.toBeNull();
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

    const saved = await store.saveWorkspace("owner-1", "workspace-test", workspace);
    const loaded = await store.loadWorkspace("owner-1", "workspace-test");

    expect(saved).toEqual(workspace);
    expect(loaded).toMatchObject({
      content: workspace,
      summary: { id: "workspace-test", role: "owner" },
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
    await store.saveWorkspace("owner-1", "workspace-test", initialWorkspace);

    const remainingDocument = initialWorkspace.documents[0];
    const nextWorkspace = {
      activeDocumentId: remainingDocument.id,
      documents: [{ ...remainingDocument, blocks: remainingDocument.blocks.slice(0, 2) }],
      updatedAt: 4000,
    };

    await store.saveWorkspace("owner-1", "workspace-test", nextWorkspace);

    expect(await store.loadWorkspace("owner-1", "workspace-test")).toMatchObject({
      content: nextWorkspace,
    });
    expect(await countRows(pool, "editor_documents")).toBe(1);
    expect(await countRows(pool, "editor_blocks")).toBe(nextWorkspace.documents[0].blocks.length);
  });

  it("allows viewers to read but rejects workspace writes", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "林夏");
    await seedUser(pool, "viewer-1", "viewer@example.com", "访客");
    await store.ensurePersonalWorkspace("owner-1", "林夏的工作区");
    const workspace = createDefaultWorkspace(1000);
    await store.saveWorkspace("owner-1", "workspace-test", workspace);
    await store.addMember("owner-1", "workspace-test", "viewer@example.com", "viewer");

    await expect(store.loadWorkspace("viewer-1", "workspace-test")).resolves.toMatchObject({
      content: workspace,
      summary: { role: "viewer" },
    });
    await expect(
      store.saveWorkspace("viewer-1", "workspace-test", workspace),
    ).rejects.toBeInstanceOf(WorkspacePermissionError);
  });

  it("lets owners grant editor access and lists real workspace members", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "林夏");
    await seedUser(pool, "editor-1", "editor@example.com", "周宁");
    await store.ensurePersonalWorkspace("owner-1", "团队知识库");

    await store.addMember("owner-1", "workspace-test", "editor@example.com", "editor");
    const members = await store.listMembers("owner-1", "workspace-test");

    expect(members).toEqual([
      expect.objectContaining({ displayName: "林夏", email: "owner@example.com", role: "owner" }),
      expect.objectContaining({ displayName: "周宁", email: "editor@example.com", role: "editor" }),
    ]);
    await expect(
      store.saveWorkspace("editor-1", "workspace-test", createDefaultWorkspace(5000)),
    ).resolves.toBeDefined();
  });

  it("locks the workspace row before granting direct membership", async () => {
    const query = vi.fn(async (text: string) => {
      if (text === "BEGIN" || text === "COMMIT") {
        return { rows: [] };
      }
      if (text.includes("FROM editor_workspaces")) {
        return { rows: [{ id: "workspace-test" }] };
      }
      if (text.includes("FROM workspace_members")) {
        return { rows: [{ role: "owner", workspace_id: "workspace-test" }] };
      }
      if (text.includes("FROM app_users")) {
        return { rows: [{ id: "editor-1" }] };
      }
      if (text.includes("INSERT INTO workspace_members")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${text}`);
    });
    const client = { query, release: vi.fn() };
    const lockTestStore = new PostgresWorkspaceStore({
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool, { now: () => 3_000 });

    await lockTestStore.addMember(
      "owner-1",
      "workspace-test",
      "editor@example.com",
      "editor",
    );

    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("FROM editor_workspaces"),
      ["workspace-test"],
    );
    expect(String(query.mock.calls[1]?.[0])).toContain("FOR UPDATE");
  });

  it("rejects member and history access when workspace and resource ids do not match", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "Owner");
    let workspaceSequence = 0;
    const scopedStore = new PostgresWorkspaceStore(pool, {
      idFactory: () => `workspace-${++workspaceSequence}`,
      now: () => 3000 + workspaceSequence,
    });
    await scopedStore.ensurePersonalWorkspace("owner-1", "Workspace A");
    const workspaceA = createDefaultWorkspace(1000);
    await scopedStore.saveWorkspace("owner-1", "workspace-1", workspaceA);
    await scopedStore.createWorkspace("owner-1", "Workspace B");

    await expect(scopedStore.listMembers("owner-1", "missing-workspace"))
      .rejects.toBeInstanceOf(WorkspaceNotFoundError);
    await expect(
      scopedStore.listDocumentVersions("owner-1", "workspace-2", workspaceA.activeDocumentId),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it("does not change an added member's selected workspace", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "Owner");
    await seedUser(pool, "editor-1", "editor@example.com", "Editor");
    let workspaceSequence = 0;
    const multiWorkspaceStore = new PostgresWorkspaceStore(pool, {
      idFactory: () => `workspace-${++workspaceSequence}`,
      now: () => 3000 + workspaceSequence,
    });
    await multiWorkspaceStore.ensurePersonalWorkspace("owner-1", "Owner workspace");
    await multiWorkspaceStore.ensurePersonalWorkspace("editor-1", "Editor workspace");
    const selectedBefore = await pool.query(
      "SELECT selected_workspace_id FROM workspace_preferences WHERE user_id = $1",
      ["editor-1"],
    );

    await multiWorkspaceStore.addMember("owner-1", "workspace-1", "editor@example.com", "editor");

    const selectedAfter = await pool.query(
      "SELECT selected_workspace_id FROM workspace_preferences WHERE user_id = $1",
      ["editor-1"],
    );
    expect(selectedAfter.rows).toEqual(selectedBefore.rows);
  });

  it("preserves another member's active document until the document is removed", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "Owner");
    await seedUser(pool, "editor-1", "editor@example.com", "Editor");
    await store.ensurePersonalWorkspace("owner-1", "Shared workspace");
    const workspace = createWorkspaceDocument(
      createDefaultWorkspace(1000),
      2000,
      "Second document",
    );
    await store.saveWorkspace("owner-1", "workspace-test", workspace);
    await store.addMember("owner-1", "workspace-test", "editor@example.com", "editor");
    await store.loadWorkspace("editor-1", "workspace-test");
    const memberActiveDocumentId = workspace.documents[1].id;
    await pool.query(
      `UPDATE workspace_document_preferences
       SET active_document_id = $1
       WHERE user_id = $2 AND workspace_id = $3`,
      [memberActiveDocumentId, "editor-1", "workspace-test"],
    );

    await store.saveWorkspace("owner-1", "workspace-test", {
      ...workspace,
      updatedAt: 3000,
    });

    const memberPreference = await pool.query(
      `SELECT active_document_id
       FROM workspace_document_preferences
       WHERE user_id = $1 AND workspace_id = $2`,
      ["editor-1", "workspace-test"],
    );
    expect(memberPreference.rows).toEqual([{
      active_document_id: memberActiveDocumentId,
    }]);

    await store.saveWorkspace("owner-1", "workspace-test", {
      activeDocumentId: workspace.documents[0].id,
      documents: [workspace.documents[0]],
      updatedAt: 4000,
    });

    const preferenceAfterRemoval = await pool.query(
      `SELECT active_document_id
       FROM workspace_document_preferences
       WHERE user_id = $1 AND workspace_id = $2`,
      ["editor-1", "workspace-test"],
    );
    expect(preferenceAfterRemoval.rows).toEqual([{
      active_document_id: null,
    }]);
  });

  it("resolves document-specific workspace access for collaboration", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "林夏");
    await seedUser(pool, "editor-1", "editor@example.com", "周宁");
    await store.ensurePersonalWorkspace("owner-1", "团队知识库");
    const workspace = createDefaultWorkspace(1000);
    await store.saveWorkspace("owner-1", "workspace-test", workspace);
    await store.addMember("owner-1", "workspace-test", "editor@example.com", "editor");

    await expect(
      store.getDocumentAccess("editor-1", "workspace-test", workspace.activeDocumentId),
    ).resolves.toEqual({
      role: "editor",
      workspaceId: "workspace-test",
    });
    await expect(
      store.getDocumentAccess("editor-1", "workspace-test", "missing-document"),
    ).resolves.toBeNull();
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

    await isolatedStore.saveWorkspace("owner-1", "isolated-workspace-1", sharedIdsWorkspace);
    await isolatedStore.saveWorkspace("owner-2", "isolated-workspace-2", {
      ...sharedIdsWorkspace,
      documents: sharedIdsWorkspace.documents.map((document) => ({ ...document, title: "第二个工作区" })),
      updatedAt: 2000,
    });

    await expect(
      isolatedStore.loadWorkspace("owner-1", "isolated-workspace-1"),
    ).resolves.toMatchObject({
      content: { documents: [expect.objectContaining({ title: "未命名文档" })] },
    });
    await expect(
      isolatedStore.loadWorkspace("owner-2", "isolated-workspace-2"),
    ).resolves.toMatchObject({
      content: { documents: [expect.objectContaining({ title: "第二个工作区" })] },
    });
  });

  it("stores deduplicated document versions and restores an earlier snapshot", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "林夏");
    await store.ensurePersonalWorkspace("owner-1", "林夏的工作区");
    const initialWorkspace = createDefaultWorkspace(1000);
    const documentId = initialWorkspace.activeDocumentId;

    await store.saveWorkspace("owner-1", "workspace-test", initialWorkspace);
    await store.saveWorkspace("owner-1", "workspace-test", initialWorkspace);

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
    await store.saveWorkspace("owner-1", "workspace-test", changedWorkspace);

    const versions = await store.listDocumentVersions("owner-1", "workspace-test", documentId);

    expect(versions).toHaveLength(2);
    expect(versions.map((version) => version.title)).toEqual(["第二版标题", "未命名文档"]);

    const restored = await store.restoreDocumentVersion(
      "owner-1",
      "workspace-test",
      documentId,
      versions[1].id,
    );

    expect(restored.title).toBe("未命名文档");
    await expect(store.loadWorkspace("owner-1", "workspace-test")).resolves.toMatchObject({
      content: {
        documents: [expect.objectContaining({ title: "未命名文档" })],
      },
    });
  });

  it("allows viewers to list versions but rejects restoring them", async () => {
    await seedUser(pool, "owner-1", "owner@example.com", "林夏");
    await seedUser(pool, "viewer-1", "viewer@example.com", "访客");
    await store.ensurePersonalWorkspace("owner-1", "林夏的工作区");
    const workspace = createDefaultWorkspace(1000);
    await store.saveWorkspace("owner-1", "workspace-test", workspace);
    await store.addMember("owner-1", "workspace-test", "viewer@example.com", "viewer");
    const versions = await store.listDocumentVersions(
      "viewer-1",
      "workspace-test",
      workspace.activeDocumentId,
    );

    expect(versions).toHaveLength(1);
    await expect(
      store.restoreDocumentVersion(
        "viewer-1",
        "workspace-test",
        workspace.activeDocumentId,
        versions[0].id,
      ),
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
