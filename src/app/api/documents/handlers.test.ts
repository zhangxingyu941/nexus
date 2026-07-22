import { describe, expect, it, vi } from "vitest";
import { DocumentNotFoundError } from "../../../server/documentAuthorization";
import { createDocumentRouteHandlers } from "./handlers";

function createHandlers() {
  const authStore = {
    getUserBySessionToken: vi.fn(),
  };
  const documentStore = {
    loadDocument: vi.fn(),
    loadDocumentPolicy: vi.fn(),
    replaceDocumentPolicy: vi.fn(),
    saveDocument: vi.fn(),
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

  it("requires an authenticated session to save a document", async () => {
    const { authStore, documentStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue(null);

    const response = await handlers.PUT(
      jsonRequest({ document: documentPayload() }),
      "public-document-1",
    );

    expect(response.status).toBe(401);
    expect(documentStore.saveDocument).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON when saving a document", async () => {
    const { authStore, documentStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "editor-1" });

    const response = await handlers.PUT(
      new Request("http://localhost/api/documents/public-document-1", {
        body: "{",
        headers: { "content-type": "application/json" },
        method: "PUT",
      }),
      "public-document-1",
    );

    expect(response.status).toBe(400);
    expect(documentStore.saveDocument).not.toHaveBeenCalled();
  });

  it("rejects a malformed document snapshot", async () => {
    const { authStore, documentStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "editor-1" });

    const response = await handlers.PUT(
      jsonRequest({ document: { id: "document-1", title: "Private document" } }),
      "public-document-1",
    );

    expect(response.status).toBe(400);
    expect(documentStore.saveDocument).not.toHaveBeenCalled();
  });

  it("hides a denied document save behind a generic not-found response", async () => {
    const { authStore, documentStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "viewer-1" });
    documentStore.saveDocument.mockRejectedValue(new DocumentNotFoundError());

    const response = await handlers.PUT(
      jsonRequest({ document: documentPayload() }),
      "public-document-1",
    );

    expect(response.status).toBe(404);
    expect(documentStore.saveDocument).toHaveBeenCalledWith(
      "viewer-1",
      "public-document-1",
      documentPayload(),
    );
  });

  it("saves a valid document snapshot", async () => {
    const { authStore, documentStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "editor-1" });
    documentStore.saveDocument.mockResolvedValue({ saved: true });

    const response = await handlers.PUT(
      jsonRequest({ document: documentPayload() }),
      "public-document-1",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ saved: true });
    expect(documentStore.saveDocument).toHaveBeenCalledWith(
      "editor-1",
      "public-document-1",
      documentPayload(),
    );
  });

  it("normalizes rich text and recomputes content before saving", async () => {
    const { authStore, documentStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "editor-1" });
    documentStore.saveDocument.mockResolvedValue({ saved: true });
    const document = documentPayload();
    document.blocks = [blockPayload({
      content: "forged",
      richText: {
        content: [{
          content: [{ marks: [{ type: "bold" }], text: "Trusted", type: "text" }],
          type: "paragraph",
        }],
        type: "doc",
      },
    })];

    const response = await handlers.PUT(jsonRequest({ document }), "public-document-1");

    expect(response.status).toBe(200);
    expect(documentStore.saveDocument).toHaveBeenCalledWith(
      "editor-1",
      "public-document-1",
      expect.objectContaining({
        blocks: [expect.objectContaining({ content: "Trusted", richText: document.blocks[0].richText })],
      }),
    );
  });

  it("returns a stable rich text error for an unsafe link", async () => {
    const { authStore, documentStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "editor-1" });
    const document = documentPayload();
    document.blocks = [blockPayload({
      richText: {
        content: [{
          content: [{
            marks: [{ attrs: { href: "javascript:alert(1)" }, type: "link" }],
            text: "unsafe",
            type: "text",
          }],
          type: "paragraph",
        }],
        type: "doc",
      },
    })];

    const response = await handlers.PUT(jsonRequest({ document }), "public-document-1");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "富文本链接不安全" });
    expect(documentStore.saveDocument).not.toHaveBeenCalled();
  });

  it("hides a policy from a document reader without manage access", async () => {
    const { authStore, documentStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "editor-1" });
    documentStore.loadDocumentPolicy.mockRejectedValue(new DocumentNotFoundError());

    const response = await handlers.GETPermissions(
      new Request("http://localhost/api/documents/public-document-1/permissions"),
      "public-document-1",
    );

    expect(response.status).toBe(404);
    expect(documentStore.loadDocumentPolicy).toHaveBeenCalledWith("editor-1", "public-document-1");
  });

  it("rejects an invalid document policy without replacing it", async () => {
    const { authStore, documentStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "owner-1" });

    const response = await handlers.PATCHPermissions(
      jsonRequest({ accessMode: "public", permissions: [] }, "PATCH"),
      "public-document-1",
    );

    expect(response.status).toBe(400);
    expect(documentStore.replaceDocumentPolicy).not.toHaveBeenCalled();
  });

  it("replaces a valid document policy for a manager", async () => {
    const { authStore, documentStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "owner-1" });
    documentStore.replaceDocumentPolicy.mockResolvedValue({
      access: { canManage: true, publicId: "public-document-1" },
      policy: policyPayload(),
    });

    const response = await handlers.PATCHPermissions(
      jsonRequest(policyPayload(), "PATCH"),
      "public-document-1",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ policy: policyPayload() });
    expect(documentStore.replaceDocumentPolicy).toHaveBeenCalledWith(
      "owner-1",
      "public-document-1",
      policyPayload(),
    );
  });
});

function documentPayload(): {
  blocks: Array<Record<string, unknown>>;
  id: string;
  title: string;
  updatedAt: number;
} {
  return {
    blocks: [],
    id: "document-1",
    title: "Private document",
    updatedAt: 1000,
  };
}

function blockPayload(overrides: Record<string, unknown> = {}) {
  return {
    assignee: "",
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
    ...overrides,
  };
}

function jsonRequest(body: unknown, method = "PUT") {
  return new Request("http://localhost/api/documents/public-document-1", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  });
}

function policyPayload() {
  return {
    accessMode: "private",
    permissions: [{ role: "viewer", userId: "editor-1" }],
  };
}
