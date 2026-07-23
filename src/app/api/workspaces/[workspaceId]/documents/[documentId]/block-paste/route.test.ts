import { describe, expect, it, vi } from "vitest";
import type { Block } from "@/features/editor/model/block";
import {
  BlockClipboardPasteAttachmentError,
  BlockClipboardPasteCleanupError,
} from "@/server/blockClipboardPasteService";
import { DocumentNotFoundError } from "@/server/documentAuthorization";
import { createBlockClipboardPasteRouteHandlers } from "./route";

describe("block clipboard paste route", () => {
  it("returns materialized blocks after accepting a same-workspace payload", async () => {
    const paste = vi.fn().mockResolvedValue([createBlock()]);
    const handlers = createBlockClipboardPasteRouteHandlers({
      authStore: { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "editor-1" }) },
      pasteService: { paste },
    });

    const response = await handlers.POST(
      request({ payload: validPayload() }),
      "workspace-1",
      "target-document",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ blocks: [createBlock()] });
    expect(paste).toHaveBeenCalledWith({
      payload: expect.objectContaining({
        sourceDocumentId: "source-document",
        sourceWorkspaceId: "workspace-1",
        version: 1,
      }),
      targetDocumentId: "target-document",
      userId: "editor-1",
      workspaceId: "workspace-1",
    });
  });

  it("rejects malformed payloads with a stable Chinese 400 response", async () => {
    const paste = vi.fn();
    const handlers = createBlockClipboardPasteRouteHandlers({
      authStore: { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "editor-1" }) },
      pasteService: { paste },
    });

    const response = await handlers.POST(
      request({ payload: { version: 2 } }),
      "workspace-1",
      "target-document",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "不支持的块剪贴板版本" });
    expect(paste).not.toHaveBeenCalled();
  });

  it("rejects cross-workspace payloads before calling the paste service", async () => {
    const paste = vi.fn();
    const handlers = createBlockClipboardPasteRouteHandlers({
      authStore: { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "editor-1" }) },
      pasteService: { paste },
    });
    const payload = validPayload();
    payload.sourceWorkspaceId = "workspace-2";

    const response = await handlers.POST(request({ payload }), "workspace-1", "target-document");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "只能粘贴同一工作区的块" });
    expect(paste).not.toHaveBeenCalled();
  });

  it("returns 403 when source read or target write authorization is denied", async () => {
    const handlers = createBlockClipboardPasteRouteHandlers({
      authStore: { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "viewer-1" }) },
      pasteService: { paste: vi.fn().mockRejectedValue(new DocumentNotFoundError()) },
    });

    const response = await handlers.POST(
      request({ payload: validPayload() }),
      "workspace-1",
      "target-document",
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "没有粘贴所需的文档权限" });
  });

  it("returns a visible failure when copied objects could not be cleaned up", async () => {
    const handlers = createBlockClipboardPasteRouteHandlers({
      authStore: { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "editor-1" }) },
      pasteService: {
        paste: vi.fn().mockRejectedValue(new BlockClipboardPasteCleanupError(
          new BlockClipboardPasteAttachmentError(new Error("copy failed")),
          [new Error("cleanup failed")],
        )),
      },
    });

    const response = await handlers.POST(
      request({ payload: validPayload() }),
      "workspace-1",
      "target-document",
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "附件复制失败，清理未完成" });
  });
});

function request(body: unknown) {
  return new Request("http://localhost/api/workspaces/workspace-1/documents/target-document/block-paste", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

function validPayload() {
  return {
    blocks: [{
      assignee: "",
      checked: false,
      content: "Copied text",
      data: null,
      dueDate: "",
      headingLevel: 1,
      richText: null,
      sourceChildren: [],
      sourceId: "source-block",
      sourceParentId: null,
      status: "unset",
      type: "paragraph",
    }],
    copiedAt: 1000,
    sourceDocumentId: "source-document",
    sourceWorkspaceId: "workspace-1",
    version: 1,
  };
}

function createBlock(): Block {
  return {
    assignee: "",
    checked: false,
    children: [],
    comments: [],
    content: "Copied text",
    createdAt: 2000,
    data: null,
    dueDate: "",
    headingLevel: 1,
    id: "copied-block",
    parentId: null,
    richText: null,
    status: "unset",
    type: "paragraph",
    updatedAt: 2000,
  };
}
