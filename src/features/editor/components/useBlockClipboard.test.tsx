import { describe, expect, it } from "vitest";
import {
  createBlockClipboardPayload,
  NEXUS_BLOCK_CLIPBOARD_MIME,
} from "../model/blockClipboard";
import { createDefaultDocument } from "../model/documentOperations";
import { readBlockClipboard } from "./useBlockClipboard";

function clipboardData(values: Record<string, string>) {
  return {
    getData: (type: string) => values[type] ?? "",
  };
}

describe("readBlockClipboard", () => {
  it("prefers a valid Nexus payload over HTML and plain text", () => {
    const document = createDefaultDocument(1000);
    const payload = createBlockClipboardPayload(document, [document.blocks[0].id], "workspace-a", 2000);

    expect(readBlockClipboard(clipboardData({
      [NEXUS_BLOCK_CLIPBOARD_MIME]: JSON.stringify(payload),
      "text/html": "<p>fallback</p>",
      "text/plain": "fallback",
    }))).toEqual({ kind: "nexus", payload });
  });

  it("falls back to sanitized HTML when the Nexus payload is invalid", () => {
    const result = readBlockClipboard(clipboardData({
      [NEXUS_BLOCK_CLIPBOARD_MIME]: '{"version":2}',
      "text/html": '<p><strong>Safe</strong><script>alert(1)</script></p>',
      "text/plain": "plain fallback",
    }));

    expect(result).toMatchObject({ fallback: "html", kind: "rich-text" });
    expect(result.kind === "rich-text" && result.richText.content[0].content).toEqual([
      { marks: [{ type: "bold" }], text: "Safe", type: "text" },
    ]);
  });

  it("falls back to a plain text paragraph when no structured clipboard data is available", () => {
    expect(readBlockClipboard(clipboardData({ "text/plain": "plain fallback" }))).toEqual({
      fallback: "plain-text",
      kind: "plain-text",
      text: "plain fallback",
    });
  });
});
