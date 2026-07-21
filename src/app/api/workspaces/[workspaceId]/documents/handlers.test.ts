import { describe, expect, it, vi } from "vitest";
import { DocumentNotFoundError } from "@/server/documentAuthorization";
import { createWorkspaceDocumentRouteHandlers } from "./handlers";

function createHandlers() {
  const authStore = { getUserBySessionToken: vi.fn() };
  const documentStore = { createDocument: vi.fn(), deleteDocument: vi.fn() };
  return {
    authStore,
    documentStore,
    handlers: createWorkspaceDocumentRouteHandlers({ authStore, documentStore }),
  };
}

describe("workspace document route handlers", () => {
  it("creates a document in the URL workspace for an authenticated editor", async () => {
    const { authStore, documentStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "editor-1" });
    documentStore.createDocument.mockResolvedValue({
      access: { publicId: "public-document-new" },
      document: documentPayload(),
    });

    const response = await handlers.POST(
      jsonRequest({ document: documentPayload(), position: 1 }),
      "workspace-1",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      access: { publicId: "public-document-new" },
    });
    expect(documentStore.createDocument).toHaveBeenCalledWith(
      "editor-1",
      "workspace-1",
      documentPayload(),
      1,
    );
  });

  it("rejects a malformed document creation request", async () => {
    const { authStore, documentStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "editor-1" });

    const response = await handlers.POST(
      jsonRequest({ document: { id: "document-new" }, position: -1 }),
      "workspace-1",
    );

    expect(response.status).toBe(400);
    expect(documentStore.createDocument).not.toHaveBeenCalled();
  });

  it("hides a denied document deletion behind a generic not-found response", async () => {
    const { authStore, documentStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "viewer-1" });
    documentStore.deleteDocument.mockRejectedValue(new DocumentNotFoundError());

    const response = await handlers.DELETE(
      new Request("http://localhost/api/workspaces/workspace-1/documents/public-document-1", {
        method: "DELETE",
      }),
      "workspace-1",
      "public-document-1",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "文档不存在或无权访问" });
    expect(documentStore.deleteDocument).toHaveBeenCalledWith(
      "viewer-1",
      "workspace-1",
      "public-document-1",
    );
  });
});

function documentPayload() {
  return {
    blocks: [],
    id: "document-new",
    title: "New document",
    updatedAt: 2000,
  };
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/workspaces/workspace-1/documents", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}
