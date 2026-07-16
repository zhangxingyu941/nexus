import type { EditorWorkspace } from "../features/editor/model/block";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEditorDocument(value: unknown) {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.blocks) &&
    typeof value.updatedAt === "number"
  );
}

export function isWorkspacePayload(value: unknown): value is EditorWorkspace {
  if (
    !isObject(value) ||
    !Array.isArray(value.documents) ||
    value.documents.length === 0 ||
    typeof value.activeDocumentId !== "string" ||
    typeof value.updatedAt !== "number"
  ) {
    return false;
  }

  return (
    value.documents.every((document) => isEditorDocument(document)) &&
    value.documents.some((document) => document.id === value.activeDocumentId)
  );
}
