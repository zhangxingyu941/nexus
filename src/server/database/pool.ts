import { Pool } from "pg";

export class DatabaseConfigurationError extends Error {
  constructor() {
    super("未配置 DATABASE_URL，PostgreSQL 模式不可用");
    this.name = "DatabaseConfigurationError";
  }
}

interface DatabaseGlobal {
  __notionEditorPool?: Pool;
}

const databaseGlobal = globalThis as typeof globalThis & DatabaseGlobal;

export function hasDatabaseConfiguration() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function createDatabasePool(connectionString = process.env.DATABASE_URL) {
  if (!connectionString?.trim()) {
    throw new DatabaseConfigurationError();
  }

  return new Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    max: 10,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
}

export function getDatabasePool() {
  if (!databaseGlobal.__notionEditorPool) {
    databaseGlobal.__notionEditorPool = createDatabasePool();
  }

  return databaseGlobal.__notionEditorPool;
}
