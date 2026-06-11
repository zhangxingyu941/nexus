import type { EditorDocument, EditorWorkspace } from "./block";
import { createDefaultDocument } from "./documentOperations";

function createDocumentId(now: number) {
  return `document-${now}`;
}

function touchWorkspace(
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

export function createDefaultWorkspace(now = Date.now()): EditorWorkspace {
  const document = createDefaultDocument(now, createDocumentId(now));

  return {
    documents: [document],
    activeDocumentId: document.id,
    updatedAt: now,
  };
}

export function getActiveDocument(workspace: EditorWorkspace): EditorDocument | null {
  return workspace.documents.find((document) => document.id === workspace.activeDocumentId) ?? null;
}

export function createWorkspaceDocument(
  workspace: EditorWorkspace,
  now = Date.now(),
): EditorWorkspace {
  const document = createDefaultDocument(now, createDocumentId(now));

  return touchWorkspace(
    workspace,
    {
      activeDocumentId: document.id,
      documents: [...workspace.documents, document],
    },
    now,
  );
}

export function switchActiveDocument(
  workspace: EditorWorkspace,
  documentId: string,
  now = Date.now(),
): EditorWorkspace {
  if (!workspace.documents.some((document) => document.id === documentId)) {
    return workspace;
  }

  return touchWorkspace(workspace, { activeDocumentId: documentId }, now);
}

export function updateActiveDocument(
  workspace: EditorWorkspace,
  updateDocument: (document: EditorDocument) => EditorDocument,
  now = Date.now(),
): EditorWorkspace {
  let changed = false;
  const documents = workspace.documents.map((document) => {
    if (document.id !== workspace.activeDocumentId) {
      return document;
    }

    changed = true;
    return updateDocument(document);
  });

  // 当前文档无效时保持原状态，避免误写到其它文档。
  return changed ? touchWorkspace(workspace, { documents }, now) : workspace;
}
