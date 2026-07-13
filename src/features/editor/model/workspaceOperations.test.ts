import { describe, expect, it } from "vitest";
import { createDemoWorkspaceFixture } from "../../../test/fixtures/workspace";
import { updateBlockContent, updateDocumentTitle } from "./documentOperations";
import {
  createDefaultWorkspace,
  createWorkspaceDocument,
  deleteWorkspaceDocument,
  duplicateWorkspaceDocument,
  getActiveDocument,
  getWorkspaceCollaborators,
  getWorkspaceActivities,
  getWorkspaceSearchResults,
  getWorkspaceTasks,
  groupWorkspaceTasksByDueDate,
  getSortedWorkspaceDocuments,
  normalizeWorkspace,
  restoreWorkspaceDocument,
  switchActiveDocument,
  toggleDocumentPinned,
  updateDocumentBlockStatus,
  updateActiveDocument,
} from "./workspaceOperations";

describe("workspace operations", () => {
  it("creates a default workspace with one active document", () => {
    const workspace = createDefaultWorkspace(1000);

    expect(workspace.activeDocumentId).toBe("document-1000");
    expect(workspace.updatedAt).toBe(1000);
    expect(workspace.documents).toHaveLength(1);
    expect(workspace.documents[0]).toMatchObject({
      id: "document-1000",
      title: "未命名文档",
      updatedAt: 1000,
    });
    expect(getWorkspaceCollaborators(workspace)).toEqual([]);
    expect(getWorkspaceTasks(workspace)).toEqual([]);
  });

  it("creates and selects a new document", () => {
    const workspace = createDefaultWorkspace(1000);
    const next = createWorkspaceDocument(workspace, 2000);

    expect(next.documents).toHaveLength(2);
    expect(next.activeDocumentId).toBe("document-2000");
    expect(getActiveDocument(next)?.id).toBe("document-2000");
  });

  it("creates a new document with a provided title", () => {
    const workspace = createDefaultWorkspace(1000);
    const next = createWorkspaceDocument(workspace, 2000, "客户访谈");

    expect(next.documents[1]).toMatchObject({
      id: "document-2000",
      title: "客户访谈",
      updatedAt: 2000,
    });
    expect(next.activeDocumentId).toBe("document-2000");
  });

  it("creates a new document from a selected template", () => {
    const workspace = createDefaultWorkspace(1000);
    const next = createWorkspaceDocument(workspace, 2000, { templateId: "meeting" });

    expect(next.documents[1]).toMatchObject({
      id: "document-2000",
      title: "会议纪要",
      templateId: "meeting",
      updatedAt: 2000,
    });
    expect(next.documents[1].blocks.map((block) => block.content)).toContain("行动项");
    expect(next.activeDocumentId).toBe("document-2000");
  });

  it("creates a demo workspace for the first experience", () => {
    const workspace = createDemoWorkspaceFixture(1000);

    expect(workspace.documents).toHaveLength(4);
    expect(getActiveDocument(workspace)).toMatchObject({
      title: "需求 PRD",
      templateId: "prd",
      pinned: true,
    });
    expect(workspace.documents.map((document) => document.title)).toEqual([
      "需求 PRD",
      "项目计划",
      "会议纪要",
      "客户访谈",
    ]);
    expect(workspace.documents[0].blocks.some((block) => block.comments.length > 0)).toBe(true);
  });

  it("toggles document pinning", () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000, "项目计划");

    const pinned = toggleDocumentPinned(workspace, "document-2000", 3000);
    const unpinned = toggleDocumentPinned(pinned, "document-2000", 4000);

    expect(pinned.documents[1]).toMatchObject({
      pinned: true,
      updatedAt: 3000,
    });
    expect(pinned.updatedAt).toBe(3000);
    expect(unpinned.documents[1]).toMatchObject({
      pinned: false,
      updatedAt: 4000,
    });
  });

  it("sorts pinned documents first and then by recent updates", () => {
    const workspace = {
      activeDocumentId: "document-a",
      updatedAt: 5000,
      documents: [
        { ...createDefaultWorkspace(1000).documents[0], id: "document-a", title: "A", updatedAt: 1000 },
        { ...createDefaultWorkspace(2000).documents[0], id: "document-b", title: "B", pinned: true, updatedAt: 2000 },
        { ...createDefaultWorkspace(4000).documents[0], id: "document-c", title: "C", updatedAt: 4000 },
        { ...createDefaultWorkspace(3000).documents[0], id: "document-d", title: "D", pinned: true, updatedAt: 3000 },
      ],
    };

    expect(getSortedWorkspaceDocuments(workspace.documents).map((document) => document.id)).toEqual([
      "document-d",
      "document-b",
      "document-c",
      "document-a",
    ]);
  });

  it("collects collaborative tasks across workspace documents", () => {
    const workspace = createDemoWorkspaceFixture(1000);

    const tasks = getWorkspaceTasks(workspace);

    expect(tasks.map((task) => task.content)).toEqual([
      "确认核心场景",
      "同步评审结论",
      "完成需求评审",
      "确认上线窗口",
      "同步会议结论",
      "确认当前流程痛点",
      "追问协作中的断点",
    ]);
    expect(tasks[0]).toMatchObject({
      documentId: "document-1000-prd",
      documentTitle: "需求 PRD",
      assignee: "林夏",
      dueDate: "今天",
      status: "in-progress",
    });
    expect(tasks.find((task) => task.content === "完成需求评审")).toMatchObject({
      documentId: "document-1000-plan",
      documentTitle: "项目计划",
    });
  });

  it("collects recent workspace activities from documents and edited blocks", () => {
    const workspace = createDemoWorkspaceFixture(1000);

    const activities = getWorkspaceActivities(workspace);

    expect(activities.slice(0, 4).map((activity) => activity.title)).toEqual([
      "需求 PRD",
      "同步评审结论",
      "确认核心场景",
      "项目计划",
    ]);
    expect(activities[0]).toMatchObject({
      documentId: "document-1000-prd",
      action: "更新了文档",
      actor: "林夏",
      time: "刚刚",
    });
    expect(activities.find((activity) => activity.title === "同步评审结论")).toMatchObject({
      blockId: "block-1000-4",
      documentTitle: "需求 PRD",
      action: "更新了任务",
      actor: "周宁",
      time: "刚刚",
    });
  });

  it("searches document titles, block content, and comments across the workspace", () => {
    const workspace = createDemoWorkspaceFixture(1000);

    const blockResults = getWorkspaceSearchResults(workspace, "上线窗口");
    const commentResults = getWorkspaceSearchResults(workspace, "成功指标");

    expect(blockResults[0]).toMatchObject({
      kind: "task",
      documentId: "document-1000-plan",
      documentTitle: "项目计划",
      title: "确认上线窗口",
      blockId: "block-0-4",
    });
    expect(commentResults[0]).toMatchObject({
      kind: "comment",
      documentId: "document-1000-prd",
      documentTitle: "需求 PRD",
      title: "这里补一段目标用户和成功指标，评审会会先看这一块。",
      blockId: "block-1000-1",
    });
  });

  it("groups workspace tasks by due date bucket", () => {
    const workspace = createDemoWorkspaceFixture(1000);

    const groups = groupWorkspaceTasksByDueDate(getWorkspaceTasks(workspace));

    expect(groups.map((group) => [group.id, group.label, group.tasks.length])).toEqual([
      ["today", "今天", 4],
      ["tomorrow", "明天", 2],
      ["week", "本周", 1],
    ]);
  });

  it("summarizes collaborators from task owners and comment authors", () => {
    const workspace = createDemoWorkspaceFixture(1000);

    const collaborators = getWorkspaceCollaborators(workspace);

    expect(collaborators.map((collaborator) => collaborator.name)).toEqual([
      "陈序",
      "林夏",
      "周宁",
    ]);
    expect(collaborators.find((collaborator) => collaborator.name === "林夏")).toMatchObject({
      role: "内容参与者",
      status: "unknown",
      activeTaskCount: 2,
      openCommentCount: 1,
    });
  });

  it("normalizes legacy workspace data with collaboration defaults", () => {
    const legacyWorkspace = {
      activeDocumentId: "legacy-document",
      updatedAt: 1000,
      documents: [
        {
          id: "legacy-document",
          title: "旧文档",
          updatedAt: 1000,
          blocks: [
            {
              id: "legacy-block",
              type: "paragraph",
              content: "旧内容",
              checked: false,
              parentId: null,
              children: [],
              createdAt: 1000,
              updatedAt: 1000,
            },
          ],
        },
      ],
    };

    const normalized = normalizeWorkspace(legacyWorkspace);

    expect(normalized.documents[0].blocks[0]).toMatchObject({
      comments: [],
      assignee: "",
      data: null,
      dueDate: "",
      status: "unset",
    });
  });

  it("normalizes valid structured block data and rejects mismatched data kinds", () => {
    const workspace = createDefaultWorkspace(1000);
    const tableData = {
      kind: "table" as const,
      columns: [{ id: "name", name: "名称" }],
      rows: [{ id: "row-1", cells: { name: "路线图" } }],
    };
    const normalized = normalizeWorkspace({
      ...workspace,
      documents: workspace.documents.map((document) => ({
        ...document,
        blocks: [
          { ...document.blocks[0], data: tableData, type: "table" },
          { ...document.blocks[0], data: tableData, id: "paragraph-with-table", type: "paragraph" },
        ],
      })),
    });

    expect(normalized.documents[0].blocks[0].data).toEqual(tableData);
    expect(normalized.documents[0].blocks[1].data).toBeNull();
  });

  it("switches to an existing document only", () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000);
    const switched = switchActiveDocument(workspace, "document-1000", 3000);
    const unchanged = switchActiveDocument(switched, "missing", 4000);

    expect(switched.activeDocumentId).toBe("document-1000");
    expect(switched.updatedAt).toBe(3000);
    expect(unchanged).toBe(switched);
  });

  it("updates only the active document", () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000);
    const activeId = workspace.activeDocumentId;
    const next = updateActiveDocument(
      workspace,
      (document) => updateBlockContent(document, document.blocks[0].id, "当前文档内容", 3000),
      3000,
    );

    expect(getActiveDocument(next)?.blocks[0].content).toBe("当前文档内容");
    expect(next.documents.find((document) => document.id !== activeId)?.blocks[0].content).toBe("");
  });

  it("updates a block status in any document", () => {
    const workspace = createDemoWorkspaceFixture(1000);

    const next = updateDocumentBlockStatus(workspace, "document-1000-prd", "block-1000-4", "done", 2000);

    expect(next.documents.find((document) => document.id === "document-1000-prd")?.blocks[4]).toMatchObject({
      content: "同步评审结论",
      status: "done",
      updatedAt: 2000,
    });
    expect(next.updatedAt).toBe(2000);
    expect(next.activeDocumentId).toBe(workspace.activeDocumentId);
  });

  it("deletes the active document and selects the nearest remaining document", () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000);
    const next = deleteWorkspaceDocument(workspace, "document-2000", 3000);

    expect(next.documents.map((document) => document.id)).toEqual(["document-1000"]);
    expect(next.activeDocumentId).toBe("document-1000");
    expect(next.updatedAt).toBe(3000);
  });

  it("restores a deleted document and selects it", () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000);
    const deletedDocument = workspace.documents[1];
    const afterDelete = deleteWorkspaceDocument(workspace, deletedDocument.id, 3000);

    const next = restoreWorkspaceDocument(afterDelete, deletedDocument, 4000);

    expect(next.documents.map((document) => document.id)).toEqual(["document-1000", "document-2000"]);
    expect(next.activeDocumentId).toBe("document-2000");
    expect(next.updatedAt).toBe(4000);
  });

  it("duplicates a document with copied blocks and selects the copy", () => {
    const workspace = createDefaultWorkspace(1000);
    const edited = updateActiveDocument(
      workspace,
      (document) =>
        updateBlockContent(updateDocumentTitle(document, "产品路线图", 1500), document.blocks[0].id, "第一阶段规划", 1600),
      1600,
    );

    const next = duplicateWorkspaceDocument(edited, "document-1000", 2000);

    expect(next.documents).toHaveLength(2);
    expect(next.activeDocumentId).toBe("document-2000");
    expect(next.updatedAt).toBe(2000);
    expect(next.documents[1]).toMatchObject({
      id: "document-2000",
      title: "产品路线图 副本",
      updatedAt: 2000,
    });
    expect(next.documents[1].blocks).toHaveLength(1);
    expect(next.documents[1].blocks[0]).toMatchObject({
      type: "paragraph",
      content: "第一阶段规划",
      checked: false,
      createdAt: 2000,
      updatedAt: 2000,
    });
    expect(next.documents[1].blocks[0].id).not.toBe(next.documents[0].blocks[0].id);
  });

  it("keeps the last document when deleting would empty the workspace", () => {
    const workspace = createDefaultWorkspace(1000);
    const next = deleteWorkspaceDocument(workspace, "document-1000", 2000);

    expect(next).toBe(workspace);
  });
});
