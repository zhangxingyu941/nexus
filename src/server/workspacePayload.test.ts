import { describe, expect, it } from "vitest";
import { RichTextValidationError, createRichTextFromPlainText } from "../shared/richText";
import { isDocumentPayload, parseDocumentPayload } from "./workspacePayload";

describe("document payload validation", () => {
  it("accepts a complete document snapshot", () => {
    expect(isDocumentPayload(documentPayload())).toBe(true);
  });

  it("rejects malformed blocks and invalid timestamps", () => {
    expect(isDocumentPayload({ ...documentPayload(), blocks: [{ id: "block-1" }] })).toBe(false);
    expect(isDocumentPayload({ ...documentPayload(), updatedAt: Number.NaN })).toBe(false);
  });

  it("normalizes rich text and replaces an untrusted plain text projection", () => {
    const payload = documentPayload();
    payload.blocks[0].content = "forged projection";
    payload.blocks[0].richText = {
      content: [{
        content: [{ marks: [{ type: "bold" }], text: "Trusted text", type: "text" }],
        type: "paragraph",
      }],
      type: "doc",
    };

    const parsed = parseDocumentPayload(payload);

    expect(parsed.blocks[0].content).toBe("Trusted text");
    expect(parsed.blocks[0].richText).toEqual(payload.blocks[0].richText);
  });

  it("upgrades a legacy text block without rich text", () => {
    const parsed = parseDocumentPayload(documentPayload());

    expect(parsed.blocks[0].richText).toEqual(createRichTextFromPlainText("Document body"));
  });

  it("rejects unsafe rich text and rich text on non-text blocks", () => {
    const unsafe = documentPayload();
    unsafe.blocks[0].richText = {
      content: [{
        content: [{
          marks: [{ attrs: { href: "javascript:alert(1)" }, type: "link" }],
          text: "unsafe",
          type: "text",
        }],
        type: "paragraph",
      }],
      type: "doc",
    };
    const code = documentPayload();
    code.blocks[0].type = "code";
    code.blocks[0].richText = createRichTextFromPlainText("code");

    expect(() => parseDocumentPayload(unsafe)).toThrow(RichTextValidationError);
    expect(() => parseDocumentPayload(code)).toThrow(RichTextValidationError);
  });
});

function documentPayload(): {
  blocks: Array<Record<string, unknown>>;
  id: string;
  title: string;
  updatedAt: number;
} {
  return {
    blocks: [
      {
        assignee: "editor-1",
        checked: false,
        children: [],
        comments: [],
        content: "Document body",
        createdAt: 1000,
        data: null,
        dueDate: "",
        headingLevel: 1,
        id: "block-1",
        parentId: null,
        status: "unset",
        type: "paragraph",
        updatedAt: 1000,
      },
    ],
    id: "document-1",
    title: "Private document",
    updatedAt: 1000,
  };
}
