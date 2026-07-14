import type { EditorWorkspace } from "./block";

export function createDocumentId(now: number) {
  return `document-${now}`;
}

export function touchWorkspace(
  workspace: EditorWorkspace,
  changes: Partial<EditorWorkspace>,
  now: number,
): EditorWorkspace {
  return {
    ...workspace,
    ...changes,
    updatedAt: now,
  };
}
