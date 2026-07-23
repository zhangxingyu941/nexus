import { describe, expect, it, vi } from "vitest";
import { createMarkdownExportRouteHandlers } from "./markdownExportRouteHandlers";

describe("markdown export route", () => {
  it("returns a server-generated markdown attachment for an authenticated reader", async () => {
    const exportDocument = vi.fn().mockResolvedValue({
      body: new TextEncoder().encode("# Export\n"),
      contentType: "text/markdown; charset=utf-8",
      filename: "Export.md",
    });
    const handlers = createMarkdownExportRouteHandlers({
      authStore: { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "reader-1" }) },
      transferService: { exportDocument },
    });

    const response = await handlers.GET(request(), "workspace-1", "public-1");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("content-disposition")).toContain("Export.md");
    await expect(response.text()).resolves.toBe("# Export\n");
    expect(exportDocument).toHaveBeenCalledWith({
      documentPublicId: "public-1",
      userId: "reader-1",
      workspaceId: "workspace-1",
    });
  });

  it("requires authentication before exporting", async () => {
    const exportDocument = vi.fn();
    const handlers = createMarkdownExportRouteHandlers({
      authStore: { getUserBySessionToken: vi.fn().mockResolvedValue(null) },
      transferService: { exportDocument },
    });

    const response = await handlers.GET(request(), "workspace-1", "public-1");

    expect(response.status).toBe(401);
    expect(exportDocument).not.toHaveBeenCalled();
  });
});

function request() {
  return new Request("http://localhost/api/workspaces/workspace-1/documents/public-1/markdown-export", {
    headers: { cookie: "notion_editor_session=session-1" },
  });
}
