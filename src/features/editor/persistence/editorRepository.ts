import { openDB } from "idb";
import type { EditorDocument } from "../model/block";

const DATABASE_NAME = "notion-block-editor";
const DATABASE_VERSION = 1;
const DOCUMENT_STORE = "documents";
const DEFAULT_DOCUMENT_KEY = "default";

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
