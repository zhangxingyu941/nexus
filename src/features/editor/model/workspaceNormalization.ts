import type { Block, BlockComment, BlockData, BlockType, EditorDocument, EditorWorkspace, HeadingLevel } from "./block";
import { createDefaultBlockData, createDefaultDocument } from "./documentOperations";
import { createDefaultWorkspace } from "./workspaceDocuments";
import type { StoredBlock, StoredBlockComment, StoredDocument, StoredWorkspace } from "./workspaceTypes";

function isBlockType(type: unknown): type is Block["type"] {
  return type === "paragraph" || type === "heading" || type === "todo" || type === "quote" || type === "code" ||
    type === "image" || type === "file" || type === "table" || type === "kanban";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeHeadingLevel(value: unknown): HeadingLevel {
  return value === 2 || value === 3 || value === 4 || value === 5 || value === 6 ? value : 1;
}

function normalizeBlockData(type: BlockType, data: unknown): BlockData | null {
  if ((type === "image" || type === "file") && isRecord(data) && data.kind === type) {
    if (
      typeof data.key === "string" &&
      typeof data.mimeType === "string" &&
      typeof data.name === "string" &&
      typeof data.size === "number" &&
      typeof data.url === "string"
    ) {
      return {
        key: data.key,
        kind: type,
        mimeType: data.mimeType,
        name: data.name,
        size: data.size,
        url: data.url,
      };
    }

    return null;
  }

  if (type === "table" && isRecord(data) && data.kind === "table") {
    const columns = Array.isArray(data.columns)
      ? data.columns.flatMap((column) =>
          isRecord(column) && typeof column.id === "string" && typeof column.name === "string"
            ? [{ id: column.id, name: column.name }]
            : [],
        )
      : [];
    const rows = Array.isArray(data.rows)
      ? data.rows.flatMap((row) => {
          if (!isRecord(row) || typeof row.id !== "string" || !isRecord(row.cells)) {
            return [];
          }

          const cells = Object.fromEntries(
            Object.entries(row.cells).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          );
          return [{ cells, id: row.id }];
        })
      : [];

    return columns.length > 0 ? { columns, kind: "table", rows } : createDefaultBlockData(type);
  }

  if (type === "kanban" && isRecord(data) && data.kind === "kanban") {
    const columns = Array.isArray(data.columns)
      ? data.columns.flatMap((column) => {
          if (!isRecord(column) || typeof column.id !== "string" || typeof column.title !== "string") {
            return [];
          }

          const cards = Array.isArray(column.cards)
            ? column.cards.flatMap((card) =>
                isRecord(card) && typeof card.id === "string" && typeof card.title === "string"
                  ? [{ id: card.id, title: card.title }]
                  : [],
              )
            : [];
          return [{ cards, id: column.id, title: column.title }];
        })
      : [];

    return columns.length > 0 ? { columns, kind: "kanban" } : createDefaultBlockData(type);
  }

  return createDefaultBlockData(type);
}

function normalizeBlock(block: StoredBlock, fallbackNow: number, fallbackIndex: number): Block {
  const type = isBlockType(block.type) ? block.type : "paragraph";

  return {
    id: block.id ?? `block-${fallbackNow}-${fallbackIndex}`,
    type,
    headingLevel: normalizeHeadingLevel(block.headingLevel),
    content: block.content ?? "",
    data: normalizeBlockData(type, block.data),
    checked: block.checked ?? false,
    comments: (block.comments ?? []).map((comment) => normalizeBlockComment(comment)),
    assignee: block.assignee ?? "",
    dueDate: block.dueDate ?? "",
    status: block.status ?? "unset",
    parentId: block.parentId ?? null,
    children: block.children ?? [],
    createdAt: block.createdAt ?? fallbackNow,
    updatedAt: block.updatedAt ?? fallbackNow,
  };
}

function normalizeBlockComment(comment: StoredBlockComment): BlockComment {
  return {
    id: comment.id ?? `comment-${comment.createdAt ?? Date.now()}`,
    author: comment.author ?? "团队成员",
    body: comment.body ?? "",
    time: comment.time ?? "刚刚",
    createdAt: comment.createdAt ?? Date.now(),
    resolved: comment.resolved ?? false,
    ...(comment.resolvedAt !== undefined ? { resolvedAt: comment.resolvedAt } : {}),
  };
}

function normalizeDocument(
  document: StoredDocument,
  fallbackNow: number,
  fallbackIndex: number,
): EditorDocument {
  const updatedAt = document.updatedAt ?? fallbackNow;
  const normalizedDocument: EditorDocument = {
    id: document.id ?? `document-${fallbackNow}-${fallbackIndex}`,
    title: document.title ?? "未命名文档",
    blocks:
      document.blocks && document.blocks.length > 0
        ? document.blocks.map((block, blockIndex) => normalizeBlock(block, updatedAt, blockIndex))
        : createDefaultDocument(updatedAt).blocks,
    updatedAt,
  };

  if (document.templateId !== undefined) {
    normalizedDocument.templateId = document.templateId;
  }

  if (document.pinned !== undefined) {
    normalizedDocument.pinned = document.pinned;
  }

  return normalizedDocument;
}

export function normalizeWorkspace(workspace: StoredWorkspace): EditorWorkspace {
  const now = workspace.updatedAt ?? Date.now();
  const documents =
    workspace.documents && workspace.documents.length > 0
      ? workspace.documents.map((document, index) => normalizeDocument(document, now, index))
      : createDefaultWorkspace(now).documents;
  const activeDocumentId =
    workspace.activeDocumentId && documents.some((document) => document.id === workspace.activeDocumentId)
      ? workspace.activeDocumentId
      : documents[0].id;

  return {
    documents,
    activeDocumentId,
    updatedAt: now,
  };
}
