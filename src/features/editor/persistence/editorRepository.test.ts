import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultDocument, updateBlockContent } from "../model/documentOperations";
import { createDefaultWorkspace, createWorkspaceDocument } from "../model/workspaceOperations";
import {
  clearDocument,
  clearWorkspace,
  loadWorkspace,
  saveDocument,
  saveWorkspace,
} from "./editorRepository";

describe("editor repository", () => {
  beforeEach(async () => {
    await clearWorkspace();
    await clearDocument();
  });

  it("saves and loads the editor workspace", async () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000);

    await saveWorkspace(workspace);

    await expect(loadWorkspace()).resolves.toEqual(workspace);
  });

  it("clears the saved workspace", async () => {
    await saveWorkspace(createDefaultWorkspace(1000));
    await clearWorkspace();

    await expect(loadWorkspace()).resolves.toBeNull();
  });

  it("migrates a saved single document into a workspace", async () => {
    const document = updateBlockContent(createDefaultDocument(1000), "block-1000", "已本地保存", 2000);

    await saveDocument(document);

    await expect(loadWorkspace()).resolves.toMatchObject({
      activeDocumentId: document.id,
      documents: [document],
      updatedAt: document.updatedAt,
    });
  });
});
