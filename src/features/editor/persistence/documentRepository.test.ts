import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultWorkspace } from "../model/workspaceOperations";
import { createDocumentRepository } from "./documentRepository";

const document = createDefaultWorkspace(1000).documents[0];
const access = {
  accessMode: "private" as const,
  canManage: true,
  canRead: true,
  canWrite: true,
  documentId: document.id,
  publicId: "public/document-1",
  role: "owner" as const,
  source: "workspace-owner" as const,
  workspaceId: "workspace-1",
};
const snapshot = { access, document };
const policy = {
  accessMode: "private" as const,
  permissions: [{ role: "viewer" as const, userId: "editor-1" }],
};

describe("document repository", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads and saves one document through its encoded public id", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshot))
      .mockResolvedValueOnce(jsonResponse(snapshot));
    vi.stubGlobal("fetch", fetchSpy);
    const repository = createDocumentRepository();

    await expect(repository.load("public/document-1")).resolves.toEqual(snapshot);
    await expect(repository.save("public/document-1", document)).resolves.toEqual(snapshot);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/documents/public%2Fdocument-1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/documents/public%2Fdocument-1",
      expect.objectContaining({ body: JSON.stringify({ document }), method: "PUT" }),
    );
  });

  it("reads and replaces document policy through the permissions endpoint", async () => {
    const policySnapshot = { access, policy };
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(jsonResponse(policySnapshot))
      .mockResolvedValueOnce(jsonResponse(policySnapshot));
    vi.stubGlobal("fetch", fetchSpy);
    const repository = createDocumentRepository();

    await expect(repository.loadPolicy("public/document-1")).resolves.toEqual(policySnapshot);
    await expect(repository.updatePolicy("public/document-1", policy)).resolves.toEqual(policySnapshot);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/documents/public%2Fdocument-1/permissions",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/documents/public%2Fdocument-1/permissions",
      expect.objectContaining({ body: JSON.stringify(policy), method: "PATCH" }),
    );
  });

  it("creates and deletes a document through its workspace-scoped endpoints", async () => {
    const deleted = { activeDocumentPublicId: "public/document-1" };
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshot))
      .mockResolvedValueOnce(jsonResponse(deleted));
    vi.stubGlobal("fetch", fetchSpy);
    const repository = createDocumentRepository();

    await expect(repository.create("workspace/a", document, 1)).resolves.toEqual(snapshot);
    await expect(repository.delete("workspace/a", "public/document-2")).resolves.toEqual(deleted);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/workspaces/workspace%2Fa/documents",
      expect.objectContaining({ body: JSON.stringify({ document, position: 1 }), method: "POST" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/workspaces/workspace%2Fa/documents/public%2Fdocument-2",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("keeps an HTTP status for direct-route error handling", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({
      error: "文档不存在或无权访问",
    }, 404)));
    const repository = createDocumentRepository();

    await expect(repository.load("private-document")).rejects.toMatchObject({ status: 404 });
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
