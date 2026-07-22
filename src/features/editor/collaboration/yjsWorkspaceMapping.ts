import type { Block, BlockData, EditorDocument } from "../model/block";
import {
  createRichTextFromPlainText,
  normalizeRichText,
  projectRichTextContent,
  type RichTextDocument,
} from "../../../shared/richText";
import { isRichTextBlockType } from "../model/documentOperations";
import type { RemoteBlockContentPatch, RemoteDocumentStructurePatch } from "../model/workspaceOperations";
import type { BlockContentRecord, DocumentStructureRecord } from "./collaborationTypes";

export function getCollaborationRoomName(workspaceId: string, documentId: string) {
  return `workspace:${workspaceId}:document:${documentId}`;
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
    richText: cloneRichText(block.richText),
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
    richText: cloneRichText(block.richText),
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
      const richText = localBlock ? normalizeRecordRichText(localBlock, record.richText, record.content) : null;
      const content = richText ? projectRichTextContent(richText) : record.content;

      return (
        localBlock &&
        record.updatedAt >= localBlock.updatedAt &&
        (
          localBlock.content !== content ||
          localBlock.checked !== record.checked ||
          !richTextEqual(localBlock.richText, richText)
        )
      );
    })
    .map((record) => {
      const localBlock = document.blocks.find((block) => block.id === record.blockId) as Block;
      const richText = normalizeRecordRichText(localBlock, record.richText, record.content);
      return {
        blockId: record.blockId,
        checked: record.checked,
        content: richText ? projectRichTextContent(richText) : record.content,
        documentId: record.documentId,
        richText,
        updatedAt: record.updatedAt,
      };
    });
}

function cloneRichText(value: RichTextDocument | null) {
  return value ? structuredClone(value) : null;
}

function richTextEqual(left: RichTextDocument | null, right: RichTextDocument | null) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeRecordRichText(
  block: Block,
  value: RichTextDocument | null | undefined,
  content: string,
): RichTextDocument | null {
  if (!isRichTextBlockType(block.type)) {
    return null;
  }

  try {
    return value ? normalizeRichText(value) : createRichTextFromPlainText(content);
  } catch {
    return createRichTextFromPlainText(content);
  }
}
