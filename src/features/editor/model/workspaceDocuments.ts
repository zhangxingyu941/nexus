import type { Block, EditorDocument, EditorWorkspace } from "./block";
import {
  createDefaultDocument,
  createDocumentFromTemplate,
} from "./documentOperations";
import { createDocumentId, touchWorkspace } from "./workspaceCore";
import type { CreateWorkspaceDocumentInput } from "./workspaceTypes";

function createCopiedBlocks(blocks: Block[], now: number): Block[] {
  const idMap = new Map(blocks.map((block, index) => [block.id, `block-${now}-${index}`]));

  return blocks.map((block) => ({
    ...block,
    id: idMap.get(block.id) ?? `block-${now}`,
    parentId: block.parentId ? (idMap.get(block.parentId) ?? null) : null,
    children: block.children
      .map((childId) => idMap.get(childId))
      .filter((childId): childId is string => Boolean(childId)),
    createdAt: now,
    updatedAt: now,
  }));
}

function createCopyTitle(title: string) {
  const displayTitle = title.trim() || "未命名文档";

  return `${displayTitle} 副本`;
}

function getCreateDocumentOptions(input?: CreateWorkspaceDocumentInput) {
  if (typeof input === "string") {
    return { title: input };
  }

  return input ?? {};
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
  titleOrOptions?: CreateWorkspaceDocumentInput,
): EditorWorkspace {
  const { templateId, title } = getCreateDocumentOptions(titleOrOptions);
  const baseDocument = templateId
    ? createDocumentFromTemplate(templateId, now, createDocumentId(now))
    : createDefaultDocument(now, createDocumentId(now));
  const document = {
    ...baseDocument,
    title: title?.trim() || baseDocument.title,
  };

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

export function deleteWorkspaceDocument(
  workspace: EditorWorkspace,
  documentId: string,
  now = Date.now(),
): EditorWorkspace {
  const documentIndex = workspace.documents.findIndex((document) => document.id === documentId);

  if (documentIndex === -1 || workspace.documents.length <= 1) {
    return workspace;
  }

  const documents = workspace.documents.filter((document) => document.id !== documentId);
  const activeDocumentId =
    workspace.activeDocumentId === documentId
      ? documents[Math.max(0, documentIndex - 1)].id
      : workspace.activeDocumentId;

  // 删除当前文档后选中相邻文档，保证右侧始终有可编辑内容。
  return touchWorkspace(workspace, { activeDocumentId, documents }, now);
}

export function toggleDocumentPinned(
  workspace: EditorWorkspace,
  documentId: string,
  now = Date.now(),
): EditorWorkspace {
  let changed = false;
  const documents = workspace.documents.map((document) => {
    if (document.id !== documentId) {
      return document;
    }

    changed = true;
    return {
      ...document,
      pinned: !document.pinned,
      updatedAt: now,
    };
  });

  return changed ? touchWorkspace(workspace, { documents }, now) : workspace;
}

export function restoreWorkspaceDocument(
  workspace: EditorWorkspace,
  document: EditorDocument,
  now = Date.now(),
): EditorWorkspace {
  if (workspace.documents.some((item) => item.id === document.id)) {
    return switchActiveDocument(workspace, document.id, now);
  }

  // 撤销删除时把文档放回列表末尾并选中，确保用户能立即继续编辑刚恢复的内容。
  return touchWorkspace(
    workspace,
    {
      activeDocumentId: document.id,
      documents: [...workspace.documents, document],
    },
    now,
  );
}

export function duplicateWorkspaceDocument(
  workspace: EditorWorkspace,
  documentId: string,
  now = Date.now(),
): EditorWorkspace {
  const documentIndex = workspace.documents.findIndex((document) => document.id === documentId);

  if (documentIndex === -1) {
    return workspace;
  }

  const sourceDocument = workspace.documents[documentIndex];
  const copiedDocument: EditorDocument = {
    id: createDocumentId(now),
    title: createCopyTitle(sourceDocument.title),
    blocks: createCopiedBlocks(sourceDocument.blocks, now),
    updatedAt: now,
  };

  // 复制后把新文档放在原文档下方并立即选中，符合用户“复制后继续编辑副本”的预期。
  return touchWorkspace(
    workspace,
    {
      activeDocumentId: copiedDocument.id,
      documents: [
        ...workspace.documents.slice(0, documentIndex + 1),
        copiedDocument,
        ...workspace.documents.slice(documentIndex + 1),
      ],
    },
    now,
  );
}

export function updateDocumentBlockStatus(
  workspace: EditorWorkspace,
  documentId: string,
  blockId: string,
  status: Block["status"],
  now = Date.now(),
): EditorWorkspace {
  let changed = false;
  const documents = workspace.documents.map((document) => {
    if (document.id !== documentId) {
      return document;
    }

    const blocks = document.blocks.map((block) => {
      if (block.id !== blockId || block.status === status) {
        return block;
      }

      changed = true;
      return {
        ...block,
        status,
        updatedAt: now,
      };
    });

    return changed
      ? {
          ...document,
          blocks,
          updatedAt: now,
        }
      : document;
  });

  return changed ? touchWorkspace(workspace, { documents }, now) : workspace;
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
