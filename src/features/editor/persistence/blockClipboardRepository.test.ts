import { afterEach, describe, expect, it, vi } from "vitest";
import { createBlockClipboardPayload } from "../model/blockClipboard";
import { createDefaultDocument } from "../model/documentOperations";
import { pasteBlockClipboard } from "./blockClipboardRepository";

describe("pasteBlockClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the clipboard payload to the exact target document route", async () => {
    const document = createDefaultDocument(100);
    const payload = createBlockClipboardPayload(document, [document.blocks[0].id], "workspace/a", 200);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ blocks: document.blocks }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(pasteBlockClipboard("workspace/a", "document/b", payload)).resolves.toEqual(document.blocks);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspaces/workspace%2Fa/documents/document%2Fb/block-paste",
      expect.objectContaining({
        body: JSON.stringify({ payload }),
        method: "POST",
      }),
    );
  });
});
