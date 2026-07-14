import "dotenv/config";
import { resolve } from "node:path";
import { migrateDatabase } from "../src/server/database/migrations";
import { createDatabasePool } from "../src/server/database/pool";
import { importWorkspaceFromFile } from "../src/server/workspaceImport";

const displayName = process.env.MIGRATION_USER_NAME?.trim();
const email = process.env.MIGRATION_USER_EMAIL?.trim();

if (!displayName || !email) {
  throw new Error("导入前请配置 MIGRATION_USER_NAME 和 MIGRATION_USER_EMAIL");
}

const pool = createDatabasePool();

try {
  await migrateDatabase(pool);
  const result = await importWorkspaceFromFile(pool, {
    displayName,
    email,
    filePath: resolve(process.env.WORKSPACE_DATA_FILE ?? "server/data/workspace.json"),
  });
  console.log(`Imported ${result.documentCount} documents and ${result.blockCount} blocks for ${result.user.email}.`);
} finally {
  await pool.end();
}
