import type { Block, EditorWorkspace } from "./block";
import {
  createRichTextFromPlainText,
  normalizeRichText,
  projectRichTextContent,
  type RichTextDocument,
} from "../../../shared/richText";
import { isRichTextBlockType } from "./documentBlockOperations";

export interface DocumentCreatedEvent {
  documentId: string;
  title: string;
  type: "document.created";
  workspaceUpdatedAt: number;
}

export interface BlockContentUpdatedEvent {
  blockId: string;
  content: string;
  documentId: string;
  richText: RichTextDocument | null;
  type: "block.content.updated";
  updatedAt: number;
  workspaceUpdatedAt: number;
}

export interface RemoteBlockContentPatch {
  blockId: string;
  checked: boolean;
  content: string;
  documentId: string;
  richText: RichTextDocument | null;
  updatedAt: number;
}

export interface RemoteDocumentStructurePatch {
  blocks: Block[];
  documentId: string;
  pinned?: boolean;
  templateId?: string;
  title: string;
  updatedAt: number;
}

export type WorkspaceContentEvent = DocumentCreatedEvent | BlockContentUpdatedEvent;

function getDocumentTitle(title: string) {
  return title.trim() || "未命名文档";
}

function findBlock(workspace: EditorWorkspace, documentId: string, blockId: string): Block | null {
  return workspace.documents.find((document) => document.id === documentId)?.blocks.find((block) => block.id === blockId) ?? null;
}

export function createDocumentCreatedEvent(
  before: EditorWorkspace,
  after: EditorWorkspace,
): DocumentCreatedEvent | null {
  const beforeDocumentIds = new Set(before.documents.map((document) => document.id));
  const createdDocument = after.documents.find((document) => !beforeDocumentIds.has(document.id));

  if (!createdDocument) {
    return null;
  }

  return {
    documentId: createdDocument.id,
    title: getDocumentTitle(createdDocument.title),
    type: "document.created",
    workspaceUpdatedAt: after.updatedAt,
  };
}

export function createBlockContentUpdatedEvent(
  before: EditorWorkspace,
  after: EditorWorkspace,
): BlockContentUpdatedEvent | null {
  for (const document of after.documents) {
    const beforeDocument = before.documents.find((item) => item.id === document.id);

    if (!beforeDocument) {
      continue;
    }

    for (const block of document.blocks) {
      const beforeBlock = findBlock(before, beforeDocument.id, block.id);

      if (beforeBlock && (
        beforeBlock.content !== block.content ||
        !richTextEqual(beforeBlock.richText, block.richText)
      )) {
        return {
          blockId: block.id,
          content: block.content,
          documentId: document.id,
          richText: cloneRichText(block.richText),
          type: "block.content.updated",
          updatedAt: block.updatedAt,
          workspaceUpdatedAt: after.updatedAt,
        };
      }
    }
  }

  return null;
}

export function getWorkspaceContentEvents(
  before: EditorWorkspace,
  after: EditorWorkspace,
): WorkspaceContentEvent[] {
  return [
    createDocumentCreatedEvent(before, after),
    createBlockContentUpdatedEvent(before, after),
  ].filter((event): event is WorkspaceContentEvent => Boolean(event));
}

export function applyRemoteBlockContentPatch(
  workspace: EditorWorkspace,
  patch: RemoteBlockContentPatch,
): EditorWorkspace {
  let changed = false;
  const documents = workspace.documents.map((document) => {
    if (document.id !== patch.documentId) {
      return document;
    }

    let documentChanged = false;
    const blocks = document.blocks.map((block) => {
      if (
        block.id !== patch.blockId ||
        patch.updatedAt < block.updatedAt ||
        (
          block.content === patch.content &&
          block.checked === patch.checked &&
          richTextEqual(block.richText, patch.richText)
        )
      ) {
        return block;
      }

      changed = true;
      documentChanged = true;
      const richText = normalizeRemoteRichText(block, patch.richText, patch.content);
      return {
        ...block,
        checked: patch.checked,
        content: richText ? projectRichTextContent(richText) : patch.content,
        richText,
        updatedAt: patch.updatedAt,
      };
    });

    return documentChanged
      ? {
          ...document,
          blocks,
          updatedAt: Math.max(document.updatedAt, patch.updatedAt),
        }
      : document;
  });

  return changed
    ? {
        ...workspace,
        documents,
        updatedAt: Math.max(workspace.updatedAt, patch.updatedAt),
      }
    : workspace;
}

function cloneRemoteBlock(block: Block): Block {
  return {
    ...block,
    children: [...block.children],
    comments: block.comments.map((comment) => ({ ...comment })),
    richText: cloneRichText(block.richText),
  };
}

function mergeRemoteBlock(localBlock: Block | undefined, remoteBlock: Block): Block {
  const nextBlock = cloneRemoteBlock(remoteBlock);

  if (!localBlock || localBlock.updatedAt <= remoteBlock.updatedAt) {
    return nextBlock;
  }

  return {
    ...nextBlock,
    assignee: localBlock.assignee,
    checked: localBlock.checked,
    comments: localBlock.comments.map((comment) => ({ ...comment })),
    content: localBlock.content,
    richText: cloneRichText(localBlock.richText),
    dueDate: localBlock.dueDate,
    status: localBlock.status,
    updatedAt: localBlock.updatedAt,
  };
}

function cloneRichText(value: RichTextDocument | null) {
  return value ? structuredClone(value) : null;
}

function richTextEqual(left: RichTextDocument | null, right: RichTextDocument | null) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeRemoteRichText(
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

export function applyRemoteDocumentStructurePatch(
  workspace: EditorWorkspace,
  patch: RemoteDocumentStructurePatch,
): EditorWorkspace {
  let changed = false;
  const documents = workspace.documents.map((document) => {
    if (document.id !== patch.documentId || patch.updatedAt <= document.updatedAt) {
      return document;
    }

    changed = true;
    return {
      ...document,
      blocks: patch.blocks.map((block) =>
        mergeRemoteBlock(
          document.blocks.find((localBlock) => localBlock.id === block.id),
          block,
        ),
      ),
      pinned: patch.pinned,
      templateId: patch.templateId,
      title: patch.title,
      updatedAt: patch.updatedAt,
    };
  });

  return changed
    ? {
        ...workspace,
        documents,
        updatedAt: patch.updatedAt,
      }
    : workspace;
}
