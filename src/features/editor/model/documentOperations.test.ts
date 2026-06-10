import { describe, expect, it } from "vitest";
import {
  changeBlockType,
  createDefaultDocument,
  deleteBlock,
  insertBlockAfter,
  moveBlock,
  toggleTodo,
  updateBlockContent,
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
      content: "",
      checked: false,
      parentId: null,
      children: [],
      createdAt: 1000,
      updatedAt: 1000,
    });
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
});
