// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createDefaultDocument } from "../model/documentOperations";
import { createMarkdownTransferRepository } from "./markdownTransferRepository";

describe("markdown transfer repository", () => {
  it("parses a local .md file without calling the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const repository = createMarkdownTransferRepository("local", { now: () => 10 });

    const result = await repository.preview(new File(["# Imported\n\nBody"], "import.md", { type: "text/markdown" }));

    expect(result.document).toMatchObject({ title: "Imported" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads original remote bytes and downloads server exports", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        diagnostics: [],
        document: createDefaultDocument(10, "document-1"),
        publicId: "public-1",
      }), { headers: { "Content-Type": "application/json" }, status: 201 }))
      .mockResolvedValueOnce(new Response("# Server export\n", {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
        status: 200,
      }));
    vi.stubGlobal("fetch", fetchMock);
    const repository = createMarkdownTransferRepository("remote", { now: () => 10 });

    const imported = await repository.importDocument("workspace-1", new File(["# Imported\n"], "import.md"));
    const exported = await repository.exportDocument("workspace-1", "public-1", createDefaultDocument(10, "document-1"));

    expect(imported.publicId).toBe("public-1");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/workspaces/workspace-1/markdown-import");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/workspaces/workspace-1/documents/public-1/markdown-export");
    await expect(exported.blob.text()).resolves.toBe("# Server export\n");
  });
});
