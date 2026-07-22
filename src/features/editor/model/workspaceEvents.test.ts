import { describe, expect, it } from "vitest";
import { createRichTextFromPlainText, type RichTextDocument } from "../../../shared/richText";
import {
  createDefaultWorkspace,
  createWorkspaceDocument,
  updateActiveDocument,
} from "./workspaceOperations";
import { insertBlockAfter, updateBlockContent, updateBlockRichText, updateDocumentTitle } from "./documentOperations";
import {
  applyRemoteDocumentStructurePatch,
  applyRemoteBlockContentPatch,
  createBlockContentUpdatedEvent,
  createDocumentCreatedEvent,
  getWorkspaceContentEvents,
} from "./workspaceEvents";

describe("workspace events", () => {
  it("creates a document.created event from a newly added document", () => {
    const before = createDefaultWorkspace(1000);
    const after = createWorkspaceDocument(before, 2000, "Collaboration doc");

    expect(createDocumentCreatedEvent(before, after)).toEqual({
      documentId: "document-2000",
      title: "Collaboration doc",
      type: "document.created",
      workspaceUpdatedAt: 2000,
    });
  });

  it("creates a block.updated event for changed block content", () => {
    const before = createDefaultWorkspace(1000);
    const blockId = before.documents[0].blocks[0].id;
    const after = updateActiveDocument(
      before,
      (document) => updateBlockContent(document, blockId, "Remote text", 2000),
      2000,
    );

    expect(createBlockContentUpdatedEvent(before, after)).toEqual({
      blockId,
      content: "Remote text",
      documentId: before.activeDocumentId,
      richText: createRichTextFromPlainText("Remote text"),
      type: "block.content.updated",
      updatedAt: 2000,
      workspaceUpdatedAt: 2000,
    });
  });

  it("collects workspace content events between snapshots", () => {
    const before = createDefaultWorkspace(1000);
    const blockId = before.documents[0].blocks[0].id;
    const after = updateActiveDocument(
      before,
      (document) => updateBlockContent(document, blockId, "Event stream text", 2000),
      2000,
    );

    expect(getWorkspaceContentEvents(before, after)).toEqual([
      {
        blockId,
        content: "Event stream text",
        documentId: before.activeDocumentId,
        richText: createRichTextFromPlainText("Event stream text"),
        type: "block.content.updated",
        updatedAt: 2000,
        workspaceUpdatedAt: 2000,
      },
    ]);
  });

  it("creates a content event when only rich text marks change", () => {
    const before = createDefaultWorkspace(1000);
    const blockId = before.documents[0].blocks[0].id;
    const richText: RichTextDocument = {
      content: [{
        content: [{ marks: [{ type: "bold" as const }], text: "same", type: "text" as const }],
        type: "paragraph" as const,
      }],
      type: "doc" as const,
    };
    const base = updateActiveDocument(
      before,
      (document) => updateBlockRichText(document, blockId, {
        content: "same",
        richText: createRichTextFromPlainText("same"),
      }, 1500),
      1500,
    );
    const after = updateActiveDocument(
      base,
      (document) => updateBlockRichText(document, blockId, { content: "same", richText }, 2000),
      2000,
    );

    expect(createBlockContentUpdatedEvent(base, after)).toMatchObject({
      blockId,
      content: "same",
      richText,
      updatedAt: 2000,
    });
  });

  it("applies a same-timestamp remote mark-only update", () => {
    const base = createDefaultWorkspace(1000);
    const document = base.documents[0];
    const block = document.blocks[0];
    const plain = updateBlockRichText(document, block.id, {
      content: "same",
      richText: createRichTextFromPlainText("same"),
    }, 2000);
    const richText: RichTextDocument = {
      content: [{
        content: [{ marks: [{ type: "bold" }], text: "same", type: "text" }],
        type: "paragraph",
      }],
      type: "doc",
    };

    const updated = applyRemoteBlockContentPatch({
      ...base,
      documents: [plain],
      updatedAt: 2000,
    }, {
      blockId: block.id,
      checked: block.checked,
      content: "same",
      documentId: document.id,
      richText,
      updatedAt: 2000,
    });

    expect(updated.documents[0].blocks[0].richText).toEqual(richText);
  });

  it("applies a remote block content patch without switching the active document", () => {
    const before = createWorkspaceDocument(createDefaultWorkspace(1000), 2000, "Second doc");
    const inactiveDocument = before.documents[0];
    const blockId = inactiveDocument.blocks[0].id;

    const after = applyRemoteBlockContentPatch(before, {
      blockId,
      checked: inactiveDocument.blocks[0].checked,
      content: "Background window text",
      documentId: inactiveDocument.id,
      richText: createRichTextFromPlainText("Background window text"),
      updatedAt: 3000,
    });

    expect(after.activeDocumentId).toBe(before.activeDocumentId);
    expect(after.documents[0].blocks[0]).toMatchObject({
      content: "Background window text",
      updatedAt: 3000,
    });
    expect(after.documents[0].updatedAt).toBe(3000);
    expect(after.updatedAt).toBe(3000);
  });

  it("ignores stale remote block content patches", () => {
    const base = createDefaultWorkspace(1000);
    const blockId = base.documents[0].blocks[0].id;
    const localDocument = updateBlockContent(base.documents[0], blockId, "Local latest", 3000);
    const before = {
      ...base,
      documents: [localDocument],
      updatedAt: 3000,
    };

    const after = applyRemoteBlockContentPatch(before, {
      blockId,
      checked: localDocument.blocks[0].checked,
      content: "Old remote",
      documentId: localDocument.id,
      richText: createRichTextFromPlainText("Old remote"),
      updatedAt: 2000,
    });

    expect(after).toBe(before);
  });

  it("ignores remote block content patches for other documents", () => {
    const before = createWorkspaceDocument(createDefaultWorkspace(1000), 2000, "Second doc");
    const activeDocument = before.documents[1];
    const inactiveDocument = before.documents[0];

    const after = applyRemoteBlockContentPatch(before, {
      blockId: activeDocument.blocks[0].id,
      checked: activeDocument.blocks[0].checked,
      content: "Wrong document payload",
      documentId: inactiveDocument.id,
      richText: createRichTextFromPlainText("Wrong document payload"),
      updatedAt: 3000,
    });

    expect(after).toBe(before);
    expect(after.documents[1].blocks[0].content).toBe(activeDocument.blocks[0].content);
  });

  it("applies a remote todo checked patch without switching the active document", () => {
    const workspace = createDefaultWorkspace(1000);
    const document = {
      ...workspace.documents[0],
      blocks: [
        {
          ...workspace.documents[0].blocks[0],
          checked: false,
          type: "todo" as const,
        },
      ],
    };
    const before = {
      ...workspace,
      documents: [document],
    };
    const blockId = document.blocks[0].id;

    const after = applyRemoteBlockContentPatch(before, {
      blockId,
      checked: true,
      content: document.blocks[0].content,
      documentId: document.id,
      richText: document.blocks[0].richText,
      updatedAt: 3000,
    });

    expect(after.activeDocumentId).toBe(before.activeDocumentId);
    expect(after.documents[0].blocks[0]).toMatchObject({
      checked: true,
      updatedAt: 3000,
    });
    expect(after.documents[0].updatedAt).toBe(3000);
    expect(after.updatedAt).toBe(3000);
  });

  it("applies a remote document structure patch without switching the active document", () => {
    const before = createWorkspaceDocument(createDefaultWorkspace(1000), 2000, "Second doc");
    const inactiveDocument = before.documents[0];
    const renamedDocument = updateDocumentTitle(inactiveDocument, "Remote title", 3000);
    const remoteDocument = insertBlockAfter(renamedDocument, inactiveDocument.blocks[0].id, 4000, "block-remote");

    const after = applyRemoteDocumentStructurePatch(before, {
      blocks: remoteDocument.blocks,
      documentId: inactiveDocument.id,
      title: remoteDocument.title,
      updatedAt: remoteDocument.updatedAt,
    });

    expect(after.activeDocumentId).toBe(before.activeDocumentId);
    expect(after.documents[0]).toMatchObject({
      id: inactiveDocument.id,
      title: "Remote title",
      updatedAt: 4000,
    });
    expect(after.documents[0].blocks.map((block) => block.id)).toEqual([
      inactiveDocument.blocks[0].id,
      "block-remote",
    ]);
    expect(after.updatedAt).toBe(4000);
  });

  it("preserves newer local block content while applying remote document structure", () => {
    const base = createDefaultWorkspace(1000);
    const blockId = base.documents[0].blocks[0].id;
    const localDocument = updateBlockContent(base.documents[0], blockId, "Local latest", 5000);
    const before = {
      ...base,
      documents: [localDocument],
      updatedAt: 5000,
    };
    const remoteBlock = {
      ...base.documents[0].blocks[0],
      content: "",
      updatedAt: 1000,
    };
    const remoteNewBlock = {
      ...base.documents[0].blocks[0],
      id: "block-remote",
      content: "Remote block",
      createdAt: 6000,
      updatedAt: 6000,
    };

    const after = applyRemoteDocumentStructurePatch(before, {
      blocks: [remoteBlock, remoteNewBlock],
      documentId: localDocument.id,
      title: localDocument.title,
      updatedAt: 6000,
    });

    expect(after.documents[0].blocks[0]).toMatchObject({
      content: "Local latest",
      updatedAt: 5000,
    });
    expect(after.documents[0].blocks.map((block) => block.id)).toEqual([blockId, "block-remote"]);
    expect(after.updatedAt).toBe(6000);
  });
});
