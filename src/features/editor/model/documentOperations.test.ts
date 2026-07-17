import { describe, expect, it } from "vitest";
import {
  changeBlockType,
  createDocumentFromTemplate,
  createDefaultDocument,
  deleteBlock,
  insertBlockAfter,
  indentBlock,
  moveBlock,
  outdentBlock,
  reorderBlock,
  restoreBlock,
  resolveBlockComment,
  setBlockAssignee,
  setBlockDueDate,
  setBlockStatus,
  toggleTodo,
  addBlockComment,
  updateBlockContent,
  updateBlockData,
  updateDocumentTitle,
} from "./documentOperations";

describe("document operations", () => {
  it("creates a default document with one empty paragraph", () => {
    const document = createDefaultDocument(1000);

    expect(document).toMatchObject({
      id: "local-document",
      title: "未命名文档",
      updatedAt: 1000,
    });
    expect(document.blocks).toHaveLength(1);
    expect(document.blocks[0]).toMatchObject({
      type: "paragraph",
      headingLevel: 1,
      content: "",
      checked: false,
      parentId: null,
      children: [],
      comments: [],
      assignee: "",
      dueDate: "",
      status: "unset",
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it("creates a PRD document from a template", () => {
    const document = createDocumentFromTemplate("prd", 2000, "document-2000");

    expect(document).toMatchObject({
      id: "document-2000",
      title: "需求 PRD",
      templateId: "prd",
      updatedAt: 2000,
    });
    expect(document.blocks.map((block) => [block.type, block.content])).toEqual([
      ["heading", "背景与目标"],
      ["paragraph", "说明业务背景、目标用户和本次迭代希望达成的结果。"],
      ["heading", "范围"],
      ["todo", "确认核心场景"],
      ["todo", "同步评审结论"],
      ["heading", "验收标准"],
      ["paragraph", "列出上线前必须满足的检查项。"],
    ]);
    expect(document.blocks[3]).toMatchObject({
      assignee: "",
      dueDate: "今天",
      status: "in-progress",
    });
    expect(document.blocks.every((block) => block.assignee === "")).toBe(true);
  });

  it("inserts a paragraph block after a target block", () => {
    const document = createDefaultDocument(1000);
    const targetId = document.blocks[0].id;

    const next = insertBlockAfter(document, targetId, 2000);

    expect(next.blocks).toHaveLength(2);
    expect(next.blocks[0].id).toBe(targetId);
    expect(next.blocks[1]).toMatchObject({
      type: "paragraph",
      content: "",
      checked: false,
      createdAt: 2000,
      updatedAt: 2000,
    });
    expect(next.updatedAt).toBe(2000);
  });

  it("updates only the target block content", () => {
    const document = insertBlockAfter(createDefaultDocument(1000), "block-1000", 2000);
    const targetId = document.blocks[1].id;

    const next = updateBlockContent(document, targetId, "Project notes", 3000);

    expect(next.blocks[0].content).toBe("");
    expect(next.blocks[1]).toMatchObject({
      id: targetId,
      content: "Project notes",
      updatedAt: 3000,
    });
    expect(next.updatedAt).toBe(3000);
  });

  it("updates the document title and timestamp", () => {
    const document = createDefaultDocument(1000);

    const next = updateDocumentTitle(document, "产品路线图", 2000);

    expect(next.title).toBe("产品路线图");
    expect(next.updatedAt).toBe(2000);
    expect(next.blocks).toBe(document.blocks);
  });

  it("changes block type and clears checked when leaving todo", () => {
    const document = createDefaultDocument(1000);
    const targetId = document.blocks[0].id;
    const todoDocument = toggleTodo(
      changeBlockType(document, targetId, "todo", 2000),
      targetId,
      3000,
    );

    const next = changeBlockType(todoDocument, targetId, "heading", 4000);

    expect(next.blocks[0]).toMatchObject({
      type: "heading",
      checked: false,
      updatedAt: 4000,
    });
  });

  it("persists a requested heading level", () => {
    const document = createDefaultDocument(1000);
    const targetId = document.blocks[0].id;

    const next = changeBlockType(document, targetId, "heading", 2000, 4);

    expect(next.blocks[0]).toMatchObject({
      headingLevel: 4,
      type: "heading",
      updatedAt: 2000,
    });
  });

  it("changes block type to quote and code blocks", () => {
    const document = createDefaultDocument(1000);
    const targetId = document.blocks[0].id;

    const quoteDocument = changeBlockType(document, targetId, "quote", 2000);
    const codeDocument = changeBlockType(quoteDocument, targetId, "code", 3000);

    expect(quoteDocument.blocks[0]).toMatchObject({
      type: "quote",
      checked: false,
      updatedAt: 2000,
    });
    expect(codeDocument.blocks[0]).toMatchObject({
      type: "code",
      checked: false,
      updatedAt: 3000,
    });
  });

  it("initializes and updates structured complex block data", () => {
    const document = createDefaultDocument(1000);
    const targetId = document.blocks[0].id;

    const tableDocument = changeBlockType(document, targetId, "table", 2000);
    const kanbanDocument = changeBlockType(tableDocument, targetId, "kanban", 3000);
    const imageDocument = changeBlockType(kanbanDocument, targetId, "image", 4000);
    const fileDocument = changeBlockType(imageDocument, targetId, "file", 5000);

    expect(tableDocument.blocks[0].data).toEqual(expect.objectContaining({
      kind: "table",
      columns: expect.arrayContaining([{ id: "column-1", name: "名称" }]),
    }));
    expect(kanbanDocument.blocks[0].data).toEqual(expect.objectContaining({
      kind: "kanban",
      columns: expect.arrayContaining([{ id: "column-todo", title: "待处理", cards: [] }]),
    }));
    expect(imageDocument.blocks[0].data).toBeNull();
    expect(fileDocument.blocks[0].data).toBeNull();

    const next = updateBlockData(
      fileDocument,
      targetId,
      {
        kind: "file",
        key: "workspace/file.pdf",
        mimeType: "application/pdf",
        name: "方案.pdf",
        size: 1024,
        url: "/api/files/workspace/file.pdf",
      },
      6000,
    );

    expect(next.blocks[0]).toMatchObject({
      data: { kind: "file", name: "方案.pdf" },
      updatedAt: 6000,
    });
    expect(next.updatedAt).toBe(6000);
  });

  it("toggles todo blocks only", () => {
    const document = createDefaultDocument(1000);
    const targetId = document.blocks[0].id;
    const todoDocument = changeBlockType(document, targetId, "todo", 2000);

    const next = toggleTodo(todoDocument, targetId, 3000);

    expect(next.blocks[0]).toMatchObject({
      type: "todo",
      checked: true,
      updatedAt: 3000,
    });
    expect(toggleTodo(changeBlockType(next, targetId, "paragraph", 4000), targetId, 5000).blocks[0].checked).toBe(false);
  });

  it("updates block collaboration fields", () => {
    const document = createDefaultDocument(1000);
    const targetId = document.blocks[0].id;

    const assigned = setBlockAssignee(document, targetId, "周宁", 2000);
    const dated = setBlockDueDate(assigned, targetId, "明天", 3000);
    const next = setBlockStatus(dated, targetId, "review", 4000);

    expect(next.blocks[0]).toMatchObject({
      assignee: "周宁",
      dueDate: "明天",
      status: "review",
      updatedAt: 4000,
    });
    expect(next.updatedAt).toBe(4000);
  });

  it("adds a comment to a specific block", () => {
    const document = createDefaultDocument(1000);
    const targetId = document.blocks[0].id;

    const next = addBlockComment(document, targetId, "陈序", "这里需要补充风险说明", 2000);

    expect(next.blocks[0].comments).toEqual([
      {
        id: "comment-2000",
        author: "陈序",
        body: "这里需要补充风险说明",
        time: "刚刚",
        createdAt: 2000,
        resolved: false,
      },
    ]);
    expect(next.updatedAt).toBe(2000);
  });

  it("resolves a block comment and refreshes the document timestamp", () => {
    const document = createDefaultDocument(1000);
    const targetId = document.blocks[0].id;
    const commented = addBlockComment(document, targetId, "陈序", "这里需要补充风险说明", 2000);

    const next = resolveBlockComment(commented, targetId, "comment-2000", 3000);

    expect(next.blocks[0].comments[0]).toMatchObject({
      id: "comment-2000",
      resolved: true,
      resolvedAt: 3000,
    });
    expect(next.blocks[0].updatedAt).toBe(3000);
    expect(next.updatedAt).toBe(3000);
  });

  it("deletes a block and preserves one empty paragraph", () => {
    const document = createDefaultDocument(1000);
    const targetId = document.blocks[0].id;

    const next = deleteBlock(document, targetId, 2000);

    expect(next.blocks).toHaveLength(1);
    expect(next.blocks[0]).toMatchObject({
      type: "paragraph",
      content: "",
      checked: false,
      createdAt: 2000,
      updatedAt: 2000,
    });
  });

  it("restores a deleted block at its previous position", () => {
    const first = createDefaultDocument(1000);
    const second = insertBlockAfter(first, first.blocks[0].id, 2000);
    const edited = updateBlockContent(second, second.blocks[1].id, "交互方案", 2500);
    const deletedBlock = edited.blocks[1];
    const afterDelete = deleteBlock(edited, deletedBlock.id, 3000);

    const next = restoreBlock(afterDelete, deletedBlock, 1, 4000);

    expect(next.blocks.map((block) => block.id)).toEqual([edited.blocks[0].id, deletedBlock.id]);
    expect(next.blocks[1]).toMatchObject({
      content: "交互方案",
      updatedAt: 4000,
    });
    expect(next.updatedAt).toBe(4000);
  });

  it("moves blocks up and down within document bounds", () => {
    const first = createDefaultDocument(1000);
    const second = insertBlockAfter(first, first.blocks[0].id, 2000);
    const third = insertBlockAfter(second, second.blocks[1].id, 3000);
    const ids = third.blocks.map((block) => block.id);

    const movedUp = moveBlock(third, ids[2], "up", 4000);
    expect(movedUp.blocks.map((block) => block.id)).toEqual([ids[0], ids[2], ids[1]]);

    const movedDown = moveBlock(movedUp, ids[0], "down", 5000);
    expect(movedDown.blocks.map((block) => block.id)).toEqual([ids[2], ids[0], ids[1]]);

    const unchanged = moveBlock(movedDown, ids[1], "down", 6000);
    expect(unchanged.blocks.map((block) => block.id)).toEqual([ids[2], ids[0], ids[1]]);
  });

  it("reorders a block before and after a target block", () => {
    const first = createDefaultDocument(1000);
    const second = insertBlockAfter(first, first.blocks[0].id, 2000, "block-2");
    const third = insertBlockAfter(second, "block-2", 3000, "block-3");
    const ids = third.blocks.map((block) => block.id);

    const before = reorderBlock(third, ids[2], ids[0], "before", 4000);
    expect(before.blocks.map((block) => block.id)).toEqual([ids[2], ids[0], ids[1]]);

    const after = reorderBlock(third, ids[0], ids[2], "after", 5000);
    expect(after.blocks.map((block) => block.id)).toEqual([ids[1], ids[2], ids[0]]);
  });

  it("ignores reordering a block into its own subtree", () => {
    const first = createDefaultDocument(1000);
    const second = insertBlockAfter(first, first.blocks[0].id, 2000, "block-2");
    const nested = indentBlock(second, "block-2", 3000);

    const result = reorderBlock(nested, nested.blocks[0].id, "block-2", "before", 4000);
    expect(result.blocks.map((block) => block.id)).toEqual(nested.blocks.map((block) => block.id));
  });

  it("indents blocks under the previous block and supports nested levels", () => {
    const first = createDefaultDocument(1000);
    const second = insertBlockAfter(first, first.blocks[0].id, 2000, "block-2");
    const document = insertBlockAfter(second, "block-2", 3000, "block-3");
    const rootId = document.blocks[0].id;

    const firstLevel = indentBlock(document, "block-2", 4000);
    const nested = indentBlock(firstLevel, "block-3", 5000);

    expect(nested.blocks[0]).toMatchObject({ id: rootId, children: ["block-2"] });
    expect(nested.blocks[1]).toMatchObject({ id: "block-2", parentId: rootId, children: ["block-3"] });
    expect(nested.blocks[2]).toMatchObject({ id: "block-3", parentId: "block-2" });
    expect(nested.updatedAt).toBe(5000);
  });

  it("outdents a block to its parent level while preserving child order", () => {
    const first = createDefaultDocument(1000);
    const second = insertBlockAfter(first, first.blocks[0].id, 2000, "block-2");
    const third = insertBlockAfter(second, "block-2", 3000, "block-3");
    const rootId = third.blocks[0].id;
    const nested = indentBlock(indentBlock(third, "block-2", 4000), "block-3", 5000);

    const firstLevel = outdentBlock(nested, "block-3", 6000);
    const rootLevel = outdentBlock(firstLevel, "block-3", 7000);

    expect(firstLevel.blocks[0].children).toEqual(["block-2", "block-3"]);
    expect(firstLevel.blocks[1]).toMatchObject({ id: "block-2", children: [] });
    expect(firstLevel.blocks[2]).toMatchObject({ id: "block-3", parentId: rootId });
    expect(rootLevel.blocks[0].children).toEqual(["block-2"]);
    expect(rootLevel.blocks[2]).toMatchObject({ id: "block-3", parentId: null });
  });

  it("inserts a new sibling after a nested block", () => {
    const first = createDefaultDocument(1000);
    const second = insertBlockAfter(first, first.blocks[0].id, 2000, "block-2");
    const nested = indentBlock(second, "block-2", 3000);
    const rootId = nested.blocks[0].id;

    const next = insertBlockAfter(nested, "block-2", 4000, "block-3");

    expect(next.blocks.map((block) => block.id)).toEqual([rootId, "block-2", "block-3"]);
    expect(next.blocks[0].children).toEqual(["block-2", "block-3"]);
    expect(next.blocks[2]).toMatchObject({ id: "block-3", parentId: rootId });
  });

  it("promotes children when deleting a parent and restores the hierarchy on undo", () => {
    const first = createDefaultDocument(1000);
    const second = insertBlockAfter(first, first.blocks[0].id, 2000, "block-2");
    const third = insertBlockAfter(second, "block-2", 3000, "block-3");
    const nested = indentBlock(indentBlock(third, "block-2", 4000), "block-3", 5000);
    const deletedBlock = nested.blocks[1];
    const rootId = nested.blocks[0].id;

    const afterDelete = deleteBlock(nested, "block-2", 6000);
    const restored = restoreBlock(afterDelete, deletedBlock, 1, 7000);

    expect(afterDelete.blocks[0].children).toEqual(["block-3"]);
    expect(afterDelete.blocks[1]).toMatchObject({ id: "block-3", parentId: rootId });
    expect(restored.blocks[0].children).toEqual(["block-2"]);
    expect(restored.blocks[1]).toMatchObject({ id: "block-2", parentId: rootId, children: ["block-3"] });
    expect(restored.blocks[2]).toMatchObject({ id: "block-3", parentId: "block-2" });
  });

  it("moves sibling subtrees without splitting parent and child blocks", () => {
    const first = createDefaultDocument(1000);
    const second = insertBlockAfter(first, first.blocks[0].id, 2000, "block-2");
    const third = insertBlockAfter(second, "block-2", 3000, "block-3");
    const nested = indentBlock(third, "block-2", 4000);
    const rootId = nested.blocks[0].id;

    const movedUp = moveBlock(nested, "block-3", "up", 5000);
    const movedDown = moveBlock(movedUp, "block-3", "down", 6000);

    expect(movedUp.blocks.map((block) => block.id)).toEqual(["block-3", rootId, "block-2"]);
    expect(movedDown.blocks.map((block) => block.id)).toEqual([rootId, "block-2", "block-3"]);
  });
});
