import { describe, expect, it } from "vitest";
import {
  changeBlockTypes,
  deleteBlocks,
  duplicateBlockRoots,
  indentBlockRoots,
  moveBlockRoots,
  outdentBlockRoots,
  toggleMarkForBlocks,
} from "./batchBlockOperations";
import type { Block, EditorDocument } from "./block";
import { createRichTextFromPlainText, projectRichTextContent } from "../../../shared/richText";

function block(id: string, overrides: Partial<Block> = {}): Block {
  const type = overrides.type ?? "paragraph";
  const content = overrides.content ?? id;
  return {
    id,
    type,
    headingLevel: 1,
    content,
    richText: type === "code" ? null : createRichTextFromPlainText(content),
    data: null,
    checked: false,
    comments: [],
    assignee: "",
    dueDate: "",
    status: "unset",
    parentId: null,
    children: [],
    createdAt: 1,
    updatedAt: 5,
    ...overrides,
  };
}

function documentWith(blocks: Block[]): EditorDocument {
  return {
    id: "document-1",
    title: "Document",
    blocks,
    updatedAt: 5,
  };
}

describe("batch block operations", () => {
  it("deletes a selected root together with its descendants", () => {
    const document = documentWith([
      block("parent", { children: ["child"] }),
      block("child", { parentId: "parent" }),
      block("sibling"),
    ]);

    const result = deleteBlocks(document, ["parent"], 100);

    expect(result.affectedBlockIds).toEqual(["parent", "child"]);
    expect(result.document.blocks.map((item) => item.id)).toEqual(["sibling"]);
    expect(result.focusBlockId).toBe("sibling");
    expect(result.document.updatedAt).toBe(100);
  });

  it("leaves one empty paragraph when deleting the final tree", () => {
    const result = deleteBlocks(
      documentWith([
        block("parent", { children: ["child"] }),
        block("child", { parentId: "parent" }),
      ]),
      ["parent"],
      100,
    );

    expect(result.affectedBlockIds).toEqual(["parent", "child"]);
    expect(result.document.blocks).toMatchObject([{ type: "paragraph", content: "" }]);
    expect(result.focusBlockId).toBe(result.document.blocks[0].id);
  });

  it("moves selected root subtrees as one ordered slice", () => {
    const document = documentWith([
      block("a", { children: ["a-child"] }),
      block("a-child", { parentId: "a" }),
      block("target"),
      block("c"),
    ]);

    const result = moveBlockRoots(document, ["a", "c"], "target", "after", 100);

    expect(result.error).toBeUndefined();
    expect(result.document.blocks.map((item) => item.id)).toEqual(["target", "a", "a-child", "c"]);
    expect(result.affectedBlockIds).toEqual(["a", "c"]);
    expect(result.focusBlockId).toBe("a");
  });

  it("rejects a move into the selected subtree without mutation", () => {
    const document = documentWith([
      block("a", { children: ["a-child"] }),
      block("a-child", { parentId: "a" }),
      block("target"),
    ]);

    const result = moveBlockRoots(document, ["a"], "a-child", "before", 100);

    expect(result.document).toBe(document);
    expect(result.affectedBlockIds).toEqual([]);
    expect(result.error).toBe("\u4e0d\u80fd\u79fb\u52a8\u5230\u6240\u9009\u5757\u7684\u5b50\u6811\u4e2d");
  });

  it("rejects an invalid runtime move position without mutation", () => {
    const document = documentWith([block("a"), block("target")]);

    const result = moveBlockRoots(document, ["a"], "target", "middle" as never, 100);

    expect(result.document).toBe(document);
    expect(result.affectedBlockIds).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it("indents contiguous roots below their preceding sibling in selection order", () => {
    const document = documentWith([block("a"), block("b"), block("c")]);

    const result = indentBlockRoots(document, ["b", "c"], 100);

    expect(result.error).toBeUndefined();
    expect(result.document.blocks.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(result.document.blocks.find((item) => item.id === "a")?.children).toEqual(["b", "c"]);
    expect(result.document.blocks.find((item) => item.id === "b")?.parentId).toBe("a");
    expect(result.document.blocks.find((item) => item.id === "c")?.parentId).toBe("a");
    expect(result.focusBlockId).toBe("b");
  });

  it("rejects an invalid indent atomically", () => {
    const document = documentWith([block("a"), block("b")]);

    const result = indentBlockRoots(document, ["a", "b"], 100);

    expect(result.document).toBe(document);
    expect(result.affectedBlockIds).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it("outdents contiguous roots after their former parent", () => {
    const document = documentWith([
      block("parent", { children: ["b", "c"] }),
      block("b", { parentId: "parent" }),
      block("c", { parentId: "parent" }),
    ]);

    const result = outdentBlockRoots(document, ["b", "c"], 100);

    expect(result.error).toBeUndefined();
    expect(result.document.blocks.map((item) => item.id)).toEqual(["parent", "b", "c"]);
    expect(result.document.blocks.find((item) => item.id === "parent")?.children).toEqual([]);
    expect(result.document.blocks.find((item) => item.id === "b")?.parentId).toBeNull();
    expect(result.document.blocks.find((item) => item.id === "c")?.parentId).toBeNull();
    expect(result.focusBlockId).toBe("b");
  });

  it("rejects an outdent when the root has no parent", () => {
    const document = documentWith([block("a")]);

    const result = outdentBlockRoots(document, ["a"], 100);

    expect(result.document).toBe(document);
    expect(result.affectedBlockIds).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it("changes selected block types while preserving their text contract", () => {
    const document = documentWith([
      block("paragraph"),
      block("todo", { checked: true, type: "todo" }),
    ]);

    const result = changeBlockTypes(document, ["paragraph", "todo"], "heading", 100, 2);

    expect(result.error).toBeUndefined();
    expect(result.affectedBlockIds).toEqual(["paragraph", "todo"]);
    expect(result.document.blocks).toMatchObject([
      { checked: false, headingLevel: 2, type: "heading" },
      { checked: false, headingLevel: 2, type: "heading" },
    ]);
    expect(result.document.blocks.every((item) => item.richText !== null)).toBe(true);
  });

  it("rejects complex batch type targets without mutation", () => {
    const document = documentWith([block("paragraph")]);

    const result = changeBlockTypes(document, ["paragraph"], "image", 100);

    expect(result.document).toBe(document);
    expect(result.affectedBlockIds).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it("adds and removes marks for compatible text blocks without changing their text", () => {
    const document = documentWith([
      block("paragraph", { content: "first" }),
      block("code", { content: "source", richText: null, type: "code" }),
      block("todo", { content: "second", type: "todo" }),
    ]);

    const added = toggleMarkForBlocks(document, ["paragraph", "code", "todo"], "bold", 100);

    expect(added.affectedBlockIds).toEqual(["paragraph", "todo"]);
    expect(added.document.blocks.find((item) => item.id === "code")?.richText).toBeNull();
    expect(
      added.document.blocks
        .filter((item) => item.type !== "code")
        .map((item) => projectRichTextContent(item.richText!)),
    ).toEqual(["first", "second"]);
    expect(
      added.document.blocks
        .filter((item) => item.type !== "code")
        .every((item) => item.richText?.content[0].content?.[0]?.type === "text" && item.richText.content[0].content[0].marks?.some((mark) => mark.type === "bold")),
    ).toBe(true);

    const removed = toggleMarkForBlocks(added.document, ["paragraph", "code", "todo"], "bold", 101);

    expect(removed.affectedBlockIds).toEqual(["paragraph", "todo"]);
    expect(
      removed.document.blocks
        .filter((item) => item.type !== "code")
        .every((item) => item.richText?.content[0].content?.[0]?.type === "text" && !item.richText.content[0].content[0].marks?.some((mark) => mark.type === "bold")),
    ).toBe(true);
  });

  it("rejects an unsupported runtime mark without mutation", () => {
    const document = documentWith([block("paragraph")]);

    const result = toggleMarkForBlocks(document, ["paragraph"], "link" as never, 100);

    expect(result.document).toBe(document);
    expect(result.affectedBlockIds).toEqual([]);
    expect(result.error).toBeDefined();
  });

  it("touches the document once and only timestamps actually changed blocks", () => {
    const document = documentWith([block("changed"), block("unchanged")]);

    const result = changeBlockTypes(document, ["changed"], "heading", 100, 2);

    expect(result.document.updatedAt).toBe(100);
    expect(result.document.blocks.find((item) => item.id === "changed")?.updatedAt).toBe(100);
    expect(result.document.blocks.find((item) => item.id === "unchanged")?.updatedAt).toBe(5);
  });

  it("duplicates root subtrees with remapped relations and empty comments", () => {
    const document = documentWith([
      block("parent", {
        children: ["child"],
        comments: [{ id: "comment-1", author: "A", body: "note", time: "now", createdAt: 1, resolved: false }],
      }),
      block("child", { parentId: "parent" }),
    ]);
    const source = structuredClone(document);
    const ids = ["copy-parent", "copy-child"];

    const result = duplicateBlockRoots(document, ["parent"], {
      nextId: () => ids.shift()!,
      now: 100,
    });

    expect(result.error).toBeUndefined();
    expect(result.document.blocks.map((item) => item.id)).toEqual(["parent", "child", "copy-parent", "copy-child"]);
    expect(result.document.blocks.find((item) => item.id === "copy-parent")).toMatchObject({
      children: ["copy-child"],
      comments: [],
      createdAt: 100,
      parentId: null,
      updatedAt: 100,
    });
    expect(result.document.blocks.find((item) => item.id === "copy-child")).toMatchObject({
      children: [],
      comments: [],
      parentId: "copy-parent",
    });
    expect(result.focusBlockId).toBe("copy-parent");
    expect(document).toEqual(source);
  });
});
