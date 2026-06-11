import { describe, expect, it } from "vitest";
import { updateBlockContent } from "./documentOperations";
import {
  createDefaultWorkspace,
  createWorkspaceDocument,
  deleteWorkspaceDocument,
  getActiveDocument,
  switchActiveDocument,
  updateActiveDocument,
} from "./workspaceOperations";

describe("workspace operations", () => {
  it("creates a default workspace with one active document", () => {
    const workspace = createDefaultWorkspace(1000);

    expect(workspace.activeDocumentId).toBe("document-1000");
    expect(workspace.updatedAt).toBe(1000);
    expect(workspace.documents).toHaveLength(1);
    expect(workspace.documents[0]).toMatchObject({
      id: "document-1000",
      title: "未命名文档",
      updatedAt: 1000,
    });
  });

  it("creates and selects a new document", () => {
    const workspace = createDefaultWorkspace(1000);
    const next = createWorkspaceDocument(workspace, 2000);

    expect(next.documents).toHaveLength(2);
    expect(next.activeDocumentId).toBe("document-2000");
    expect(getActiveDocument(next)?.id).toBe("document-2000");
  });

  it("switches to an existing document only", () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000);
    const switched = switchActiveDocument(workspace, "document-1000", 3000);
    const unchanged = switchActiveDocument(switched, "missing", 4000);

    expect(switched.activeDocumentId).toBe("document-1000");
    expect(switched.updatedAt).toBe(3000);
    expect(unchanged).toBe(switched);
  });

  it("updates only the active document", () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000);
    const activeId = workspace.activeDocumentId;
    const next = updateActiveDocument(
      workspace,
      (document) => updateBlockContent(document, document.blocks[0].id, "当前文档内容", 3000),
      3000,
    );

    expect(getActiveDocument(next)?.blocks[0].content).toBe("当前文档内容");
    expect(next.documents.find((document) => document.id !== activeId)?.blocks[0].content).toBe("");
  });

  it("deletes the active document and selects the nearest remaining document", () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000);
    const next = deleteWorkspaceDocument(workspace, "document-2000", 3000);

    expect(next.documents.map((document) => document.id)).toEqual(["document-1000"]);
    expect(next.activeDocumentId).toBe("document-1000");
    expect(next.updatedAt).toBe(3000);
  });

  it("keeps the last document when deleting would empty the workspace", () => {
    const workspace = createDefaultWorkspace(1000);
    const next = deleteWorkspaceDocument(workspace, "document-1000", 2000);

    expect(next).toBe(workspace);
  });
});
