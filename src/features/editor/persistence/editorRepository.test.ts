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

  it("normalizes saved workspace data from older versions", async () => {
    const legacyWorkspace = {
      activeDocumentId: "legacy-document",
      updatedAt: 1000,
      documents: [
        {
          id: "legacy-document",
          title: "旧文档",
          updatedAt: 1000,
          blocks: [
            {
              id: "legacy-block",
              type: "paragraph",
              content: "旧内容",
              checked: false,
              parentId: null,
              children: [],
              createdAt: 1000,
              updatedAt: 1000,
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof saveWorkspace>[0];

    await saveWorkspace(legacyWorkspace);

    await expect(loadWorkspace()).resolves.toMatchObject({
      documents: [
        {
          blocks: [
            {
              comments: [],
              assignee: "",
              dueDate: "",
              status: "unset",
            },
          ],
        },
      ],
    });
  });

  it("normalizes older comments as unresolved", async () => {
    const legacyWorkspace = {
      activeDocumentId: "legacy-document",
      updatedAt: 1000,
      documents: [
        {
          id: "legacy-document",
          title: "旧文档",
          updatedAt: 1000,
          blocks: [
            {
              id: "legacy-block",
              type: "paragraph",
              content: "旧内容",
              checked: false,
              comments: [
                {
                  id: "legacy-comment",
                  author: "林夏",
                  body: "旧评论",
                  time: "昨天",
                  createdAt: 900,
                },
              ],
              parentId: null,
              children: [],
              createdAt: 1000,
              updatedAt: 1000,
            },
          ],
        },
      ],
    } as unknown as Parameters<typeof saveWorkspace>[0];

    await saveWorkspace(legacyWorkspace);

    await expect(loadWorkspace()).resolves.toMatchObject({
      documents: [
        {
          blocks: [
            {
              comments: [
                {
                  id: "legacy-comment",
                  resolved: false,
                },
              ],
            },
          ],
        },
      ],
    });
  });
});
