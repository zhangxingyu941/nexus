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
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
