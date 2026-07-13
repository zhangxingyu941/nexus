import type { Block, BlockData, EditorDocument } from "../model/block";
import type { RemoteBlockContentPatch, RemoteDocumentStructurePatch } from "../model/workspaceOperations";
import type { BlockContentRecord, DocumentStructureRecord } from "./collaborationTypes";

export function getCollaborationRoomName(documentId: string) {
  return `document:${documentId}`;
}

export function getBlockCollaborationField(blockId: string) {
  return `block-content:${blockId}`;
}

export function createBlockContentRecords(document: EditorDocument): BlockContentRecord[] {
  return document.blocks.map((block) => ({
    blockId: block.id,
    checked: block.checked,
    content: block.content,
    documentId: document.id,
    updatedAt: block.updatedAt,
  }));
}

function cloneBlockData(data: BlockData | null): BlockData | null {
  if (!data) {
    return null;
  }

  if (data.kind === "table") {
    return {
      columns: data.columns.map((column) => ({ ...column })),
      kind: "table",
      rows: data.rows.map((row) => ({ cells: { ...row.cells }, id: row.id })),
    };
  }

  if (data.kind === "kanban") {
    return {
      columns: data.columns.map((column) => ({
        ...column,
        cards: column.cards.map((card) => ({ ...card })),
      })),
      kind: "kanban",
    };
  }

  return { ...data };
}

function cloneBlock(block: Block): Block {
  return {
    ...block,
    children: [...block.children],
    comments: block.comments.map((comment) => ({ ...comment })),
    data: cloneBlockData(block.data),
  };
}

export function createDocumentStructureRecord(document: EditorDocument): DocumentStructureRecord {
  return {
    blocks: document.blocks.map(cloneBlock),
    documentId: document.id,
    pinned: document.pinned,
    templateId: document.templateId,
    title: document.title,
    updatedAt: document.updatedAt,
  };
}

export function createRemoteDocumentStructurePatch(
  document: EditorDocument,
  record: DocumentStructureRecord | undefined,
): RemoteDocumentStructurePatch | null {
  if (!record || record.documentId !== document.id || record.updatedAt <= document.updatedAt) {
    return null;
  }

  return {
    blocks: record.blocks.map(cloneBlock),
    documentId: record.documentId,
    pinned: record.pinned,
    templateId: record.templateId,
    title: record.title,
    updatedAt: record.updatedAt,
  };
}

export function createRemotePatchesFromRecords(
  document: EditorDocument,
  records: BlockContentRecord[],
): RemoteBlockContentPatch[] {
  return records
    .filter((record) => record.documentId === document.id)
    .filter((record) => {
      const localBlock = document.blocks.find((block) => block.id === record.blockId);

      return (
        localBlock &&
        record.updatedAt > localBlock.updatedAt &&
        (localBlock.content !== record.content || localBlock.checked !== record.checked)
      );
    })
    .map((record) => ({
      blockId: record.blockId,
      checked: record.checked,
      content: record.content,
      documentId: record.documentId,
      updatedAt: record.updatedAt,
    }));
}
