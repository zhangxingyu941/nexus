import { describe, expect, it } from "vitest";
import {
  DocumentAuthorizationService,
  DocumentNotFoundError,
  type DocumentAuthorizationRecord,
} from "./documentAuthorization";

function createService(record: DocumentAuthorizationRecord | null) {
  return new DocumentAuthorizationService({
    findRecord: async () => record,
    findWorkspaceDocumentRecord: async () => record,
  });
}

describe("DocumentAuthorizationService", () => {
  it("gives every workspace owner full access to a private document", async () => {
    const access = await createService({
      accessMode: "private",
      documentId: "document-1",
      documentCreatedBy: "author-1",
      explicitRole: null,
      publicId: "public-document-1",
      workspaceId: "workspace-1",
      workspaceRole: "owner",
    }).resolveUserAccess("owner-2", "document-1");

    expect(access).toMatchObject({
      canManage: true,
      canRead: true,
      canWrite: true,
      role: "owner",
      source: "workspace-owner",
      publicId: "public-document-1",
    });
  });

  it("keeps the author writable after the document becomes private", async () => {
    const access = await createService({
      accessMode: "private",
      documentId: "document-1",
      documentCreatedBy: "author-1",
      explicitRole: null,
      publicId: "public-document-1",
      workspaceId: "workspace-1",
      workspaceRole: "viewer",
    }).resolveUserAccess("author-1", "document-1");

    expect(access).toMatchObject({
      canManage: false,
      canRead: true,
      canWrite: true,
      role: "editor",
      source: "author",
    });
  });

  it("uses an explicit viewer grant before private workspace inheritance", async () => {
    const access = await createService({
      accessMode: "private",
      documentId: "document-1",
      documentCreatedBy: "author-1",
      explicitRole: "viewer",
      publicId: "public-document-1",
      workspaceId: "workspace-1",
      workspaceRole: "editor",
    }).resolveUserAccess("viewer-1", "document-1");

    expect(access).toMatchObject({
      canManage: false,
      canRead: true,
      canWrite: false,
      role: "viewer",
      source: "explicit",
    });
  });

  it("inherits workspace editor access outside private mode", async () => {
    const access = await createService({
      accessMode: "workspace",
      documentId: "document-1",
      documentCreatedBy: "author-1",
      explicitRole: null,
      publicId: "public-document-1",
      workspaceId: "workspace-1",
      workspaceRole: "editor",
    }).resolveUserAccess("editor-1", "document-1");

    expect(access).toMatchObject({
      canManage: false,
      canRead: true,
      canWrite: true,
      role: "editor",
      source: "workspace",
    });
  });

  it("returns no access for an ungranted private workspace member", async () => {
    await expect(createService({
      accessMode: "private",
      documentId: "document-1",
      documentCreatedBy: "author-1",
      explicitRole: null,
      publicId: "public-document-1",
      workspaceId: "workspace-1",
      workspaceRole: "editor",
    }).resolveUserAccess("editor-1", "document-1")).resolves.toBeNull();
  });

  it("hides denied write actions behind a not-found error", async () => {
    const service = createService({
      accessMode: "private",
      documentId: "document-1",
      documentCreatedBy: "author-1",
      explicitRole: "viewer",
      publicId: "public-document-1",
      workspaceId: "workspace-1",
      workspaceRole: "editor",
    });

    await expect(service.requireUserAction("viewer-1", "document-1", "write"))
      .rejects.toBeInstanceOf(DocumentNotFoundError);
  });

  it("uses the same policy when authorizing an internal workspace document reference", async () => {
    const service = createService({
      accessMode: "private",
      documentId: "document-1",
      documentCreatedBy: "author-1",
      explicitRole: "viewer",
      publicId: "public-document-1",
      workspaceId: "workspace-1",
      workspaceRole: "editor",
    });

    await expect(service.requireWorkspaceDocumentAction(
      "viewer-1",
      "workspace-1",
      "document-1",
      "write",
    )).rejects.toBeInstanceOf(DocumentNotFoundError);
  });
});
