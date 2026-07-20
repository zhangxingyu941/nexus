import { describe, expect, it } from "vitest";
import { isDocumentPayload } from "./workspacePayload";

describe("document payload validation", () => {
  it("accepts a complete document snapshot", () => {
    expect(isDocumentPayload(documentPayload())).toBe(true);
  });

  it("rejects malformed blocks and invalid timestamps", () => {
    expect(isDocumentPayload({ ...documentPayload(), blocks: [{ id: "block-1" }] })).toBe(false);
    expect(isDocumentPayload({ ...documentPayload(), updatedAt: Number.NaN })).toBe(false);
  });
});

function documentPayload() {
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
