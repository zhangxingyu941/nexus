import { describe, expect, it } from "vitest";
import {
  clipboardPayloadToPlainText,
  clipboardPayloadToSafeHtml,
  createBlockClipboardPayload,
  insertClipboardBlocksAfter,
  materializeClipboardBlocks,
  parseBlockClipboardPayload,
} from "./blockClipboard";
import type { Block, EditorDocument } from "./block";
import { createRichTextFromPlainText } from "../../../shared/richText";

function block(id: string, overrides: Partial<Block> = {}): Block {
  const type = overrides.type ?? "paragraph";
  const content = overrides.content ?? id;
  return {
    id,
    type,
    headingLevel: 1,
    content,
    richText: type === "paragraph" ? createRichTextFromPlainText(content) : null,
    data: null,
    checked: false,
    comments: [],
    assignee: "",
    dueDate: "",
    status: "unset",
    parentId: null,
    children: [],
    createdAt: 10,
    updatedAt: 20,
    ...overrides,
  };
}

function documentWith(blocks: Block[]): EditorDocument {
  return {
    id: "document-source",
    title: "Source",
    blocks,
    updatedAt: 20,
  };
}

describe("block clipboard", () => {
  it("serializes selected root subtrees without comments, timestamps, or object keys", () => {
    const document = documentWith([
      block("parent", {
        children: ["image"],
        comments: [{ id: "comment-1", author: "A", body: "private", time: "now", createdAt: 10, resolved: false }],
        content: "Parent",
        richText: {
          content: [{ content: [{ marks: [{ type: "bold" }], text: "Parent", type: "text" }], type: "paragraph" }],
          type: "doc",
        },
      }),
      block("image", {
        data: {
          key: "private-object-key",
          kind: "image",
          mimeType: "image/png",
          name: "diagram.png",
          size: 42,
          url: "/api/files/private-object-key",
        },
        parentId: "parent",
        type: "image",
      }),
    ]);

    const payload = createBlockClipboardPayload(document, ["parent"], "workspace-a", 100);

    expect(payload.blocks.map((item) => item.sourceId)).toEqual(["parent", "image"]);
    expect(payload.blocks[0]).not.toHaveProperty("comments");
    expect(payload.blocks[0]).not.toHaveProperty("createdAt");
    expect(JSON.stringify(payload)).not.toContain("private-object-key");
    expect(clipboardPayloadToPlainText(payload)).toBe("Parent\ndiagram.png");
    expect(clipboardPayloadToSafeHtml(payload)).toContain("<strong>Parent</strong>");
  });

  it("rejects unknown versions and relations that escape the payload", () => {
    expect(parseBlockClipboardPayload({ version: 2 })).toEqual({
      payload: null,
      reason: "不支持的块剪贴板版本",
    });

    const invalid = {
      blocks: [{
        assignee: "",
        checked: false,
        content: "Parent",
        data: null,
        dueDate: "",
        headingLevel: 1,
        richText: createRichTextFromPlainText("Parent"),
        sourceChildren: ["outside"],
        sourceId: "parent",
        sourceParentId: null,
        status: "unset",
        type: "paragraph",
      }],
      copiedAt: 100,
      sourceDocumentId: "document-source",
      sourceWorkspaceId: "workspace-a",
      version: 1,
    };

    expect(parseBlockClipboardPayload(invalid)).toEqual({
      payload: null,
      reason: "块剪贴板关系无效",
    });

    const mismatchedParent = {
      ...invalid,
      blocks: [
        { ...invalid.blocks[0], sourceChildren: [] },
        {
          ...invalid.blocks[0],
          content: "Child",
          richText: createRichTextFromPlainText("Child"),
          sourceChildren: [],
          sourceId: "child",
          sourceParentId: "parent",
        },
      ],
    };

    expect(parseBlockClipboardPayload(mismatchedParent)).toEqual({
      payload: null,
      reason: "块剪贴板关系无效",
    });
  });

  it("clears assignees and degrades cross-workspace attachments to paragraphs", () => {
    const payload = createBlockClipboardPayload(
      documentWith([
        block("image", {
          assignee: "member-a",
          data: {
            key: "private-object-key",
            kind: "image",
            mimeType: "image/png",
            name: "diagram.png",
            size: 42,
            url: "/api/files/private-object-key",
          },
          type: "image",
        }),
      ]),
      ["image"],
      "workspace-a",
      100,
    );

    const inserted = materializeClipboardBlocks(payload, {
      nextId: () => "new-image",
      now: 200,
      targetWorkspaceId: "workspace-b",
    });

    expect(inserted).toEqual([
      expect.objectContaining({
        assignee: "",
        content: "diagram.png",
        data: null,
        id: "new-image",
        type: "paragraph",
      }),
    ]);
  });

  it("inserts materialized root subtrees after a nested target without splitting either tree", () => {
    const target = documentWith([
      block("parent", { children: ["target", "after"] }),
      block("target", { parentId: "parent" }),
      block("after", { parentId: "parent" }),
    ]);
    const inserted = [
      block("new-parent", { children: ["new-child"] }),
      block("new-child", { parentId: "new-parent" }),
    ];

    const result = insertClipboardBlocksAfter(target, "target", inserted, 100);

    expect(result.document.blocks.map(({ id }) => id)).toEqual([
      "parent",
      "target",
      "new-parent",
      "new-child",
      "after",
    ]);
    expect(result.document.blocks[0].children).toEqual(["target", "new-parent", "after"]);
    expect(result.document.blocks[2]).toMatchObject({ parentId: "parent", updatedAt: 100 });
    expect(result.document.blocks[3]).toMatchObject({ parentId: "new-parent" });
    expect(result.affectedBlockIds).toEqual(["new-parent", "new-child"]);
    expect(result.focusBlockId).toBe("new-parent");
  });

  it("rejects inserted children that are absent from their claimed parent's child list", () => {
    const target = documentWith([block("target")]);
    const result = insertClipboardBlocksAfter(target, "target", [
      block("new-parent"),
      block("new-child", { parentId: "new-parent" }),
    ], 100);

    expect(result).toMatchObject({
      affectedBlockIds: [],
      document: target,
      focusBlockId: null,
    });
  });
});
