import { describe, expect, it } from "vitest";
import { changeBlockType, insertBlockAfter, updateBlockData, updateDocumentTitle } from "../model/documentOperations";
import { createDefaultWorkspace, createWorkspaceDocument } from "../model/workspaceOperations";
import {
  createBlockContentRecords,
  createDocumentStructureRecord,
  createRemoteDocumentStructurePatch,
  getBlockCollaborationField,
  createRemotePatchesFromRecords,
  getCollaborationRoomName,
} from "./yjsWorkspaceMapping";

describe("Yjs workspace mapping", () => {
  it("uses document id as the collaboration room boundary", () => {
    expect(getCollaborationRoomName("document-1")).toBe("document:document-1");
  });

  it("uses block id as the TipTap collaboration field boundary", () => {
    expect(getBlockCollaborationField("block-1")).toBe("block-content:block-1");
  });

  it("creates block content records for a document", () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000, "协同文档");
    const document = workspace.documents[1];

    expect(createBlockContentRecords(document)).toEqual([
      {
        blockId: document.blocks[0].id,
        checked: document.blocks[0].checked,
        content: "",
        documentId: document.id,
        updatedAt: document.blocks[0].updatedAt,
      },
    ]);
  });

  it("creates remote patches only for changed records", () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000, "协同文档");
    const document = workspace.documents[1];
    const block = document.blocks[0];

    expect(
      createRemotePatchesFromRecords(document, [
        {
          blockId: block.id,
          checked: block.checked,
          content: "远端内容",
          documentId: document.id,
          updatedAt: 3000,
        },
      ]),
    ).toEqual([
      {
        blockId: block.id,
        checked: block.checked,
        content: "远端内容",
        documentId: document.id,
        updatedAt: 3000,
      },
    ]);
  });

  it("ignores stale remote block content records", () => {
    const localDocument = createDefaultWorkspace(1000).documents[0];
    const block = localDocument.blocks[0];
    const newerLocalDocument = {
      ...localDocument,
      blocks: [
        {
          ...block,
          content: "Local latest",
          updatedAt: 3000,
        },
      ],
      updatedAt: 3000,
    };

    expect(
      createRemotePatchesFromRecords(newerLocalDocument, [
        {
          blockId: block.id,
          checked: block.checked,
          content: "Old remote",
          documentId: localDocument.id,
          updatedAt: 2000,
        },
      ]),
    ).toEqual([]);
  });

  it("creates remote patches when a todo checked state changes", () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000, "鍗忓悓鏂囨。");
    const document = {
      ...workspace.documents[1],
      blocks: [
        {
          ...workspace.documents[1].blocks[0],
          checked: false,
          type: "todo" as const,
        },
      ],
    };
    const block = document.blocks[0];

    expect(
      createRemotePatchesFromRecords(document, [
        {
          blockId: block.id,
          checked: true,
          content: block.content,
          documentId: document.id,
          updatedAt: 3000,
        },
      ]),
    ).toEqual([
      {
        blockId: block.id,
        checked: true,
        content: block.content,
        documentId: document.id,
        updatedAt: 3000,
      },
    ]);
  });

  it("creates document structure records for block order and type changes", () => {
    const document = createDefaultWorkspace(1000).documents[0];
    const firstBlock = document.blocks[0];
    const renamedDocument = updateDocumentTitle(document, "Remote title", 2000);
    const documentWithNewBlock = insertBlockAfter(renamedDocument, firstBlock.id, 3000, "block-remote");
    const changedDocument = changeBlockType(documentWithNewBlock, "block-remote", "quote", 4000);

    expect(createDocumentStructureRecord(changedDocument)).toMatchObject({
      blocks: [
        {
          id: firstBlock.id,
          type: firstBlock.type,
        },
        {
          id: "block-remote",
          type: "quote",
        },
      ],
      documentId: document.id,
      title: "Remote title",
      updatedAt: 4000,
    });
  });

  it("creates remote document structure patches only from newer snapshots", () => {
    const localDocument = createDefaultWorkspace(1000).documents[0];
    const remoteDocument = insertBlockAfter(localDocument, localDocument.blocks[0].id, 3000, "block-remote");
    const remoteRecord = createDocumentStructureRecord(remoteDocument);

    expect(createRemoteDocumentStructurePatch(localDocument, remoteRecord)).toMatchObject({
      blocks: [
        {
          id: localDocument.blocks[0].id,
        },
        {
          id: "block-remote",
        },
      ],
      documentId: localDocument.id,
      updatedAt: 3000,
    });
    expect(createRemoteDocumentStructurePatch(remoteDocument, createDocumentStructureRecord(localDocument))).toBeNull();
  });

  it("copies structured block data across document structure snapshots", () => {
    const document = createDefaultWorkspace(1000).documents[0];
    const blockId = document.blocks[0].id;
    const tableDocument = changeBlockType(document, blockId, "table", 2000);
    const data = {
      kind: "table" as const,
      columns: [{ id: "name", name: "名称" }],
      rows: [{ id: "row-1", cells: { name: "协同路线图" } }],
    };
    const changedDocument = updateBlockData(tableDocument, blockId, data, 3000);
    const record = createDocumentStructureRecord(changedDocument);

    expect(record.blocks[0].data).toEqual(data);
    expect(record.blocks[0].data).not.toBe(changedDocument.blocks[0].data);
    expect(createRemoteDocumentStructurePatch(document, record)?.blocks[0].data).toEqual(data);
  });
});
