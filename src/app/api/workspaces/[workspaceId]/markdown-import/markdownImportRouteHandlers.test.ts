// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { MarkdownTransferError } from "@/server/markdownDocumentTransferService";
import { createMarkdownImportRouteHandlers } from "./markdownImportRouteHandlers";

describe("markdown import route", () => {
  it("requires a session before reading an uploaded file", async () => {
    const importDocument = vi.fn();
    const handlers = createMarkdownImportRouteHandlers({
      authStore: { getUserBySessionToken: vi.fn().mockResolvedValue(null) },
      transferService: { importDocument },
    });

    const response = await handlers.POST(markdownRequest("# Import\n"), "workspace-1");

    expect(response.status).toBe(401);
    expect(importDocument).not.toHaveBeenCalled();
  });

  it("passes original multipart bytes to the transfer service", async () => {
    const importDocument = vi.fn().mockResolvedValue({
      diagnostics: [],
      document: { id: "document-1", title: "Import" },
      publicId: "public-1",
    });
    const handlers = createMarkdownImportRouteHandlers({
      authStore: { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "editor-1" }) },
      transferService: { importDocument },
    });

    const response = await handlers.POST(markdownRequest("# Import\n"), "workspace-1");

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ publicId: "public-1" });
    expect(importDocument).toHaveBeenCalledWith(expect.objectContaining({
      filename: "import.md",
      source: new TextEncoder().encode("# Import\n"),
      userId: "editor-1",
      workspaceId: "workspace-1",
    }));
  });

  it("returns parser diagnostics without creating a document", async () => {
    const importDocument = vi.fn().mockRejectedValue(new MarkdownTransferError("markdown_parse_invalid", [{
      code: "markdown_html_unsupported",
      column: 1,
      line: 1,
      message: "Raw HTML is unsupported",
      severity: "error",
    }]));
    const handlers = createMarkdownImportRouteHandlers({
      authStore: { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "editor-1" }) },
      transferService: { importDocument },
    });

    const response = await handlers.POST(markdownRequest("<div>bad</div>"), "workspace-1");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ diagnostics: [expect.objectContaining({ code: "markdown_html_unsupported" })] });
  });
});

function markdownRequest(content: string) {
  const form = new FormData();
  form.set("file", new File([content], "import.md", { type: "text/markdown" }));
  const request = new Request("http://localhost/api/workspaces/workspace-1/markdown-import", {
    body: form,
    method: "POST",
  });
  request.headers.set("cookie", "notion_editor_session=session-1");
  return request;
}
