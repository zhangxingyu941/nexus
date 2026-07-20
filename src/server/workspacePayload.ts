import type { EditorDocument, EditorWorkspace } from "../features/editor/model/block";

const BLOCK_TYPES = new Set([
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

const BLOCK_STATUSES = new Set(["unset", "todo", "in-progress", "review", "done"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isBlockData(value: unknown): boolean {
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

function isBlockComment(value: unknown): boolean {
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

function isBlock(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.type === "string" &&
    BLOCK_TYPES.has(value.type) &&
    isFiniteNumber(value.headingLevel) &&
    value.headingLevel >= 1 &&
    value.headingLevel <= 6 &&
    typeof value.content === "string" &&
    isBlockData(value.data) &&
    typeof value.checked === "boolean" &&
    Array.isArray(value.comments) &&
    value.comments.every(isBlockComment) &&
    typeof value.assignee === "string" &&
    typeof value.dueDate === "string" &&
    typeof value.status === "string" &&
    BLOCK_STATUSES.has(value.status) &&
    (value.parentId === null || typeof value.parentId === "string") &&
    isStringArray(value.children) &&
    isFiniteNumber(value.createdAt) &&
    isFiniteNumber(value.updatedAt)
  );
}

export function isDocumentPayload(value: unknown): value is EditorDocument {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.blocks) &&
    value.blocks.every(isBlock) &&
    isFiniteNumber(value.updatedAt) &&
    (value.templateId === undefined || typeof value.templateId === "string") &&
    (value.pinned === undefined || typeof value.pinned === "boolean")
  );
}

export function isWorkspacePayload(value: unknown): value is EditorWorkspace {
  if (
    !isObject(value) ||
    !Array.isArray(value.documents) ||
    value.documents.length === 0 ||
    typeof value.activeDocumentId !== "string" ||
    !isFiniteNumber(value.updatedAt)
  ) {
    return false;
  }

  return (
    value.documents.every((document) => isDocumentPayload(document)) &&
    value.documents.some((document) => document.id === value.activeDocumentId)
  );
}
