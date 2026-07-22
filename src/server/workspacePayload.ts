import type {
  Block,
  BlockComment,
  BlockData,
  BlockStatus,
  BlockType,
  EditorDocument,
  EditorWorkspace,
  HeadingLevel,
} from "../features/editor/model/block";
import { isRichTextBlockType } from "../features/editor/model/documentOperations";
import {
  RichTextValidationError,
  createRichTextFromPlainText,
  normalizeRichText,
  projectRichTextContent,
} from "../shared/richText";

const BLOCK_TYPES = new Set<BlockType>([
  "paragraph",
  "heading",
  "todo",
  "quote",
  "code",
  "image",
  "file",
  "table",
  "kanban",
  "divider",
  "bulletedList",
  "numberedList",
  "toggle",
  "formula",
  "linkCard",
]);

const BLOCK_STATUSES = new Set<BlockStatus>(["unset", "todo", "in-progress", "review", "done"]);

export class WorkspacePayloadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePayloadValidationError";
  }
}

export function parseDocumentPayload(value: unknown): EditorDocument {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    !Array.isArray(value.blocks) ||
    !isFiniteNumber(value.updatedAt) ||
    (value.templateId !== undefined && typeof value.templateId !== "string") ||
    (value.pinned !== undefined && typeof value.pinned !== "boolean")
  ) {
    throw new WorkspacePayloadValidationError("文档数据格式不正确");
  }

  const document: EditorDocument = {
    blocks: value.blocks.map(parseBlockPayload),
    id: value.id,
    title: value.title,
    updatedAt: value.updatedAt,
  };
  if (value.templateId !== undefined) document.templateId = value.templateId;
  if (value.pinned !== undefined) document.pinned = value.pinned;
  return document;
}

export function parseWorkspacePayload(value: unknown): EditorWorkspace {
  if (
    !isObject(value) ||
    !Array.isArray(value.documents) ||
    value.documents.length === 0 ||
    typeof value.activeDocumentId !== "string" ||
    !isFiniteNumber(value.updatedAt)
  ) {
    throw new WorkspacePayloadValidationError("工作区数据格式不正确");
  }

  let documents: EditorDocument[];
  try {
    documents = value.documents.map(parseDocumentPayload);
  } catch (error) {
    if (error instanceof RichTextValidationError) throw error;
    throw new WorkspacePayloadValidationError("工作区数据格式不正确");
  }
  if (!documents.some((document) => document.id === value.activeDocumentId)) {
    throw new WorkspacePayloadValidationError("工作区数据格式不正确");
  }

  return {
    activeDocumentId: value.activeDocumentId,
    documents,
    updatedAt: value.updatedAt,
  };
}

export function isDocumentPayload(value: unknown): value is EditorDocument {
  try {
    parseDocumentPayload(value);
    return true;
  } catch {
    return false;
  }
}

export function isWorkspacePayload(value: unknown): value is EditorWorkspace {
  try {
    parseWorkspacePayload(value);
    return true;
  } catch {
    return false;
  }
}

function parseBlockPayload(value: unknown): Block {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    !isBlockType(value.type) ||
    !isHeadingLevel(value.headingLevel) ||
    typeof value.content !== "string" ||
    !isBlockData(value.data) ||
    typeof value.checked !== "boolean" ||
    !Array.isArray(value.comments) ||
    !value.comments.every(isBlockComment) ||
    typeof value.assignee !== "string" ||
    typeof value.dueDate !== "string" ||
    !isBlockStatus(value.status) ||
    (value.parentId !== null && typeof value.parentId !== "string") ||
    !isStringArray(value.children) ||
    !isFiniteNumber(value.createdAt) ||
    !isFiniteNumber(value.updatedAt)
  ) {
    throw new WorkspacePayloadValidationError("文档数据格式不正确");
  }

  const richText = isRichTextBlockType(value.type)
    ? value.richText === undefined || value.richText === null
      ? createRichTextFromPlainText(value.content)
      : normalizeRichText(value.richText)
    : null;
  if (!isRichTextBlockType(value.type) && value.richText !== undefined && value.richText !== null) {
    throw new RichTextValidationError("unsupported-block");
  }

  return {
    assignee: value.assignee,
    checked: value.checked,
    children: [...value.children],
    comments: value.comments.map(cloneBlockComment),
    content: richText ? projectRichTextContent(richText) : value.content,
    createdAt: value.createdAt,
    data: value.data ? structuredClone(value.data) : null,
    dueDate: value.dueDate,
    headingLevel: value.headingLevel,
    id: value.id,
    parentId: value.parentId,
    richText,
    status: value.status,
    type: value.type,
    updatedAt: value.updatedAt,
  };
}

function cloneBlockComment(value: BlockComment): BlockComment {
  return {
    author: value.author,
    body: value.body,
    createdAt: value.createdAt,
    id: value.id,
    resolved: value.resolved,
    ...(value.resolvedAt !== undefined ? { resolvedAt: value.resolvedAt } : {}),
    time: value.time,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && BLOCK_TYPES.has(value as BlockType);
}

function isBlockStatus(value: unknown): value is BlockStatus {
  return typeof value === "string" && BLOCK_STATUSES.has(value as BlockStatus);
}

function isHeadingLevel(value: unknown): value is HeadingLevel {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 1 && value <= 6;
}

function isBlockData(value: unknown): value is BlockData | null {
  if (value === null) return true;
  if (!isObject(value) || typeof value.kind !== "string") return false;

  switch (value.kind) {
    case "image":
    case "file":
      return (
        typeof value.key === "string" &&
        typeof value.mimeType === "string" &&
        typeof value.name === "string" &&
        isFiniteNumber(value.size) &&
        typeof value.url === "string"
      );
    case "table":
      return (
        Array.isArray(value.columns) &&
        value.columns.every(
          (column) => isObject(column) && typeof column.id === "string" && typeof column.name === "string",
        ) &&
        Array.isArray(value.rows) &&
        value.rows.every(
          (row) =>
            isObject(row) &&
            typeof row.id === "string" &&
            isObject(row.cells) &&
            Object.values(row.cells).every((cell) => typeof cell === "string"),
        )
      );
    case "kanban":
      return (
        Array.isArray(value.columns) &&
        value.columns.every(
          (column) =>
            isObject(column) &&
            typeof column.id === "string" &&
            typeof column.title === "string" &&
            Array.isArray(column.cards) &&
            column.cards.every(
              (card) => isObject(card) && typeof card.id === "string" && typeof card.title === "string",
            ),
        )
      );
    case "toggle":
      return typeof value.collapsed === "boolean";
    case "formula":
      return typeof value.latex === "string";
    case "linkCard":
      return (
        typeof value.url === "string" &&
        typeof value.title === "string" &&
        typeof value.description === "string"
      );
    default:
      return false;
  }
}

function isBlockComment(value: unknown): value is BlockComment {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.author === "string" &&
    typeof value.body === "string" &&
    typeof value.time === "string" &&
    isFiniteNumber(value.createdAt) &&
    typeof value.resolved === "boolean" &&
    (value.resolvedAt === undefined || isFiniteNumber(value.resolvedAt))
  );
}
