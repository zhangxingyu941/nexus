import { openDB } from "idb";
import type { EditorDocument, EditorWorkspace } from "../model/block";
import { normalizeWorkspace } from "../model/workspaceOperations";

const DATABASE_NAME = "notion-block-editor";
const DATABASE_VERSION = 1;
const DOCUMENT_STORE = "documents";
const DEFAULT_DOCUMENT_KEY = "default";
const WORKSPACE_KEY = "workspace";

async function getDatabase() {
  return openDB(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      // 版本升级时只创建缺失的对象仓库，保留用户已有本地文档。
      if (!database.objectStoreNames.contains(DOCUMENT_STORE)) {
        database.createObjectStore(DOCUMENT_STORE);
      }
    },
  });
}

export async function loadDocument(): Promise<EditorDocument | null> {
  const database = await getDatabase();
  const document = await database.get(DOCUMENT_STORE, DEFAULT_DOCUMENT_KEY);

  // 仓库层统一把“没有保存过”表达为 null，组件层不用关心 IndexedDB 返回细节。
  return document ?? null;
}

export async function saveDocument(document: EditorDocument): Promise<void> {
  const database = await getDatabase();
  await database.put(DOCUMENT_STORE, document, DEFAULT_DOCUMENT_KEY);
}

export async function clearDocument(): Promise<void> {
  const database = await getDatabase();
  await database.delete(DOCUMENT_STORE, DEFAULT_DOCUMENT_KEY);
}

export async function loadWorkspace(): Promise<EditorWorkspace | null> {
  const database = await getDatabase();
  const workspace = await database.get(DOCUMENT_STORE, WORKSPACE_KEY);

  if (workspace) {
    return normalizeWorkspace(workspace);
  }

  const legacyDocument = await loadDocument();

  // 兼容第一版单文档存储，把旧文档包装成工作区。
  return legacyDocument
    ? normalizeWorkspace({
        documents: [legacyDocument],
        activeDocumentId: legacyDocument.id,
        updatedAt: legacyDocument.updatedAt,
      })
    : null;
}

export async function saveWorkspace(workspace: EditorWorkspace): Promise<void> {
  const database = await getDatabase();
  await database.put(DOCUMENT_STORE, workspace, WORKSPACE_KEY);
}

export async function clearWorkspace(): Promise<void> {
  const database = await getDatabase();
  await database.delete(DOCUMENT_STORE, WORKSPACE_KEY);
}
