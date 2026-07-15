import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  normalizeWorkspaceName,
  sortWorkspaceSummaries,
  type WorkspaceSnapshot,
  type WorkspaceSummary,
} from "../../../shared/workspace";
import type { EditorDocument, EditorWorkspace } from "../model/block";
import {
  createDefaultWorkspace,
  normalizeWorkspace,
} from "../model/workspaceOperations";
import type { StoredWorkspace } from "../model/workspaceTypes";
import type { WorkspaceRepository } from "./workspaceRepository";

const DATABASE_NAME = "notion-block-editor";
const DATABASE_VERSION = 2;
const LEGACY_STORE = "documents";
const CATALOG_STORE = "workspaceCatalog";
const CONTENT_STORE = "workspaceContents";
const PREFERENCES_STORE = "preferences";
const SELECTED_KEY = "selectedWorkspaceId";
const MIGRATION_KEY = "v2MigrationComplete";
const DEFAULT_WORKSPACE_ID = "local-default";
const DEFAULT_WORKSPACE_NAME = "Nexus 工作区";
const LEGACY_WORKSPACE_KEY = "workspace";
const LEGACY_DOCUMENT_KEY = "default";

interface LocalWorkspaceRecord {
  createdAt: number;
  id: string;
  name: string;
  updatedAt: number;
}

interface LocalWorkspaceDatabase extends DBSchema {
  documents: {
    key: string;
    value: unknown;
  };
  workspaceCatalog: {
    key: string;
    value: LocalWorkspaceRecord;
  };
  workspaceContents: {
    key: string;
    value: EditorWorkspace;
  };
  preferences: {
    key: string;
    value: boolean | string;
  };
}

interface LocalWorkspaceRepositoryOptions {
  databaseName?: string;
  idFactory?: () => string;
  now?: () => number;
}

export function createLocalWorkspaceRepository(
  options: LocalWorkspaceRepositoryOptions = {},
): WorkspaceRepository {
  const databaseName = options.databaseName ?? DATABASE_NAME;
  const idFactory = options.idFactory ?? (() => `local-${globalThis.crypto.randomUUID()}`);
  const now = options.now ?? Date.now;
  let databasePromise: Promise<IDBPDatabase<LocalWorkspaceDatabase>> | null = null;

  async function getDatabase() {
    databasePromise ??= openDB<LocalWorkspaceDatabase>(databaseName, DATABASE_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(LEGACY_STORE)) {
          database.createObjectStore(LEGACY_STORE);
        }
        if (!database.objectStoreNames.contains(CATALOG_STORE)) {
          database.createObjectStore(CATALOG_STORE);
        }
        if (!database.objectStoreNames.contains(CONTENT_STORE)) {
          database.createObjectStore(CONTENT_STORE);
        }
        if (!database.objectStoreNames.contains(PREFERENCES_STORE)) {
          database.createObjectStore(PREFERENCES_STORE);
        }
      },
    });

    const database = await databasePromise;
    await ensureV2Migration(database, now);
    return database;
  }

  return {
    target: "local",

    async list() {
      const database = await getDatabase();
      const transaction = database.transaction(
        [CATALOG_STORE, PREFERENCES_STORE],
        "readonly",
      );
      const [records, selectedValue] = await Promise.all([
        transaction.objectStore(CATALOG_STORE).getAll(),
        transaction.objectStore(PREFERENCES_STORE).get(SELECTED_KEY),
      ]);
      await transaction.done;

      if (records.length === 0) {
        throw workspaceNotFoundError();
      }

      const summaries = records.map(toWorkspaceSummary);
      const selectedWorkspaceId = typeof selectedValue === "string"
        && summaries.some((workspace) => workspace.id === selectedValue)
        ? selectedValue
        : sortWorkspaceSummaries(summaries, "")[0].id;

      if (selectedValue !== selectedWorkspaceId) {
        const preferenceTransaction = database.transaction(PREFERENCES_STORE, "readwrite");
        await runWriteTransaction(preferenceTransaction, async () => {
          await preferenceTransaction.objectStore(PREFERENCES_STORE).put(
            selectedWorkspaceId,
            SELECTED_KEY,
          );
        });
      }

      return {
        currentWorkspaceId: selectedWorkspaceId,
        workspaces: sortWorkspaceSummaries(summaries, selectedWorkspaceId),
      };
    },

    async load(workspaceId) {
      const database = await getDatabase();
      return loadSnapshot(database, workspaceId);
    },

    async create(nameInput) {
      const database = await getDatabase();
      const name = normalizeWorkspaceName(nameInput);
      const workspaceId = idFactory();
      const timestamp = now();
      const content = createDefaultWorkspace(timestamp);
      const record: LocalWorkspaceRecord = {
        createdAt: timestamp,
        id: workspaceId,
        name,
        updatedAt: content.updatedAt,
      };
      const transaction = database.transaction(
        [CATALOG_STORE, CONTENT_STORE, PREFERENCES_STORE],
        "readwrite",
      );
      return runWriteTransaction(transaction, async () => {
        await transaction.objectStore(CATALOG_STORE).add(record, workspaceId);
        await transaction.objectStore(CONTENT_STORE).add(content, workspaceId);
        await transaction.objectStore(PREFERENCES_STORE).put(workspaceId, SELECTED_KEY);
        return toWorkspaceSnapshot(record, content);
      });
    },

    async rename(workspaceId, nameInput) {
      const database = await getDatabase();
      const name = normalizeWorkspaceName(nameInput);
      const transaction = database.transaction(CATALOG_STORE, "readwrite");
      return runWriteTransaction(transaction, async () => {
        const store = transaction.objectStore(CATALOG_STORE);
        const record = await store.get(workspaceId);
        if (!record) {
          throw workspaceNotFoundError();
        }

        const renamed = { ...record, name, updatedAt: now() };
        await store.put(renamed, workspaceId);
        return toWorkspaceSummary(renamed);
      });
    },

    async select(workspaceId) {
      const database = await getDatabase();
      const transaction = database.transaction(
        [CATALOG_STORE, CONTENT_STORE, PREFERENCES_STORE],
        "readwrite",
      );
      return runWriteTransaction(transaction, async () => {
        const [record, storedContent] = await Promise.all([
          transaction.objectStore(CATALOG_STORE).get(workspaceId),
          transaction.objectStore(CONTENT_STORE).get(workspaceId),
        ]);
        if (!record || !storedContent) {
          throw workspaceNotFoundError();
        }

        const content = normalizeWorkspace(storedContent);
        await transaction.objectStore(PREFERENCES_STORE).put(workspaceId, SELECTED_KEY);
        return toWorkspaceSnapshot(record, content);
      });
    },

    async save(workspaceId, workspace) {
      const database = await getDatabase();
      const content = normalizeWorkspace(workspace);
      const transaction = database.transaction(
        [CATALOG_STORE, CONTENT_STORE],
        "readwrite",
      );
      await runWriteTransaction(transaction, async () => {
        const catalogStore = transaction.objectStore(CATALOG_STORE);
        const record = await catalogStore.get(workspaceId);
        if (!record) {
          throw workspaceNotFoundError();
        }

        await transaction.objectStore(CONTENT_STORE).put(content, workspaceId);
        await catalogStore.put({ ...record, updatedAt: content.updatedAt }, workspaceId);
      });
    },
  };
}

async function ensureV2Migration(
  database: IDBPDatabase<LocalWorkspaceDatabase>,
  now: () => number,
) {
  const transaction = database.transaction(
    [LEGACY_STORE, CATALOG_STORE, CONTENT_STORE, PREFERENCES_STORE],
    "readwrite",
  );
  await runWriteTransaction(transaction, async () => {
    const preferences = transaction.objectStore(PREFERENCES_STORE);
    const migrationComplete = await preferences.get(MIGRATION_KEY);
    if (migrationComplete === true) {
      return;
    }

    const legacyStore = transaction.objectStore(LEGACY_STORE);
    const [legacyWorkspace, legacyDocument] = await Promise.all([
      legacyStore.get(LEGACY_WORKSPACE_KEY),
      legacyStore.get(LEGACY_DOCUMENT_KEY),
    ]);
    const content = toMigratedWorkspace(legacyWorkspace, legacyDocument, now());
    const record: LocalWorkspaceRecord = {
      createdAt: content.updatedAt,
      id: DEFAULT_WORKSPACE_ID,
      name: DEFAULT_WORKSPACE_NAME,
      updatedAt: content.updatedAt,
    };

    await transaction.objectStore(CATALOG_STORE).put(record, DEFAULT_WORKSPACE_ID);
    await transaction.objectStore(CONTENT_STORE).put(content, DEFAULT_WORKSPACE_ID);
    await preferences.put(DEFAULT_WORKSPACE_ID, SELECTED_KEY);
    await legacyStore.delete(LEGACY_WORKSPACE_KEY);
    await legacyStore.delete(LEGACY_DOCUMENT_KEY);
    await preferences.put(true, MIGRATION_KEY);
  });
}

async function loadSnapshot(
  database: IDBPDatabase<LocalWorkspaceDatabase>,
  workspaceId: string,
): Promise<WorkspaceSnapshot> {
  const transaction = database.transaction(
    [CATALOG_STORE, CONTENT_STORE],
    "readonly",
  );
  const [record, storedContent] = await Promise.all([
    transaction.objectStore(CATALOG_STORE).get(workspaceId),
    transaction.objectStore(CONTENT_STORE).get(workspaceId),
  ]);
  await transaction.done;
  if (!record || !storedContent) {
    throw workspaceNotFoundError();
  }

  return toWorkspaceSnapshot(record, normalizeWorkspace(storedContent));
}

function toMigratedWorkspace(
  legacyWorkspace: unknown,
  legacyDocument: unknown,
  timestamp: number,
) {
  if (isStoredWorkspace(legacyWorkspace)) {
    return normalizeWorkspace(legacyWorkspace);
  }
  if (isLegacyDocument(legacyDocument)) {
    return normalizeWorkspace({
      activeDocumentId: legacyDocument.id,
      documents: [legacyDocument],
      updatedAt: legacyDocument.updatedAt,
    });
  }

  return createDefaultWorkspace(timestamp);
}

function isStoredWorkspace(value: unknown): value is StoredWorkspace {
  return Boolean(value && typeof value === "object" && Array.isArray((value as StoredWorkspace).documents));
}

function isLegacyDocument(value: unknown): value is EditorDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<EditorDocument>;
  return typeof document.id === "string"
    && typeof document.updatedAt === "number"
    && Array.isArray(document.blocks);
}

function toWorkspaceSnapshot(
  record: LocalWorkspaceRecord,
  content: EditorWorkspace,
): WorkspaceSnapshot {
  return {
    content,
    summary: toWorkspaceSummary(record),
  };
}

function toWorkspaceSummary(record: LocalWorkspaceRecord): WorkspaceSummary {
  return {
    ...record,
    role: "owner",
  };
}

function workspaceNotFoundError() {
  return new Error("工作区不存在");
}

async function runWriteTransaction<T>(
  transaction: { done: Promise<unknown> },
  operation: () => Promise<T>,
): Promise<T> {
  try {
    const result = await operation();
    await transaction.done;
    return result;
  } catch (error) {
    await transaction.done.catch(() => undefined);
    throw error;
  }
}
