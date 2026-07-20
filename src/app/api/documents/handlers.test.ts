import { describe, expect, it, vi } from "vitest";
import { DocumentNotFoundError } from "../../../server/documentAuthorization";
import { createDocumentRouteHandlers } from "./handlers";

function createHandlers() {
  const authStore = {
    getUserBySessionToken: vi.fn(),
  };
  const documentStore = {
    loadDocument: vi.fn(),
  };

  return {
    authStore,
    documentStore,
    handlers: createDocumentRouteHandlers({ authStore, documentStore }),
  };
}

describe("document route handlers", () => {
  it("requires an authenticated session to read a document", async () => {
    const { authStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue(null);

    const response = await handlers.GET(new Request("http://localhost/api/documents/public-document-1"), "public-document-1");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "请先进入工作区" });
  });

  it("hides an inaccessible document behind a generic not-found response", async () => {
    const { authStore, documentStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "editor-1" });
    documentStore.loadDocument.mockRejectedValue(new DocumentNotFoundError());

    const response = await handlers.GET(new Request("http://localhost/api/documents/public-document-1"), "public-document-1");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "文档不存在或无权访问" });
  });

  it("returns the authorized document snapshot", async () => {
    const { authStore, documentStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "owner-1" });
    documentStore.loadDocument.mockResolvedValue({
      access: { canRead: true, documentId: "document-1", publicId: "public-document-1", workspaceId: "workspace-1" },
      document: { blocks: [], id: "document-1", title: "Private document", updatedAt: 1000 },
    });

    const response = await handlers.GET(new Request("http://localhost/api/documents/public-document-1"), "public-document-1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      access: { publicId: "public-document-1" },
      document: { id: "document-1", title: "Private document" },
    });
    expect(documentStore.loadDocument).toHaveBeenCalledWith("owner-1", "public-document-1");
  });
});
