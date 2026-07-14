import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultWorkspace } from "../model/workspaceOperations";
import { loadDocumentVersions, restoreDocumentVersion } from "./documentHistoryRepository";

describe("document history repository", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads exact version fields from the history API", async () => {
    const versions = [
      {
        createdAt: 2000,
        createdBy: "林夏",
        documentId: "document-1",
        id: "version-2",
        title: "第二版",
      },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ versions }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );

    await expect(loadDocumentVersions("document-1")).resolves.toEqual(versions);
    expect(fetchSpy).toHaveBeenCalledWith("/api/history/document-1", expect.objectContaining({ method: "GET" }));
  });

  it("restores a version and surfaces API errors", async () => {
    const document = createDefaultWorkspace(1000).documents[0];
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ document, restored: true }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "没有恢复权限" }), {
          headers: { "Content-Type": "application/json" },
          status: 403,
        }),
      );

    await expect(restoreDocumentVersion("document-1", "version-1")).resolves.toEqual(document);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/history/document-1",
      expect.objectContaining({ body: JSON.stringify({ versionId: "version-1" }), method: "POST" }),
    );
    await expect(restoreDocumentVersion("document-1", "version-1")).rejects.toThrow("没有恢复权限");
  });
});
