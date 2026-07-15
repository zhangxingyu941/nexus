import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultWorkspace } from "../features/editor/model/workspaceOperations";
import { createPgMemPool } from "../test/pgMemDatabase";
import { migrateDatabase } from "./database/migrations";
import { PostgresWorkspaceStore } from "./postgresWorkspaceStore";
import { importWorkspaceFromFile } from "./workspaceImport";

describe("importWorkspaceFromFile", () => {
  let pool: Pool;
  let tempDir: string;

  beforeEach(async () => {
    pool = createPgMemPool();
    await migrateDatabase(pool);
    tempDir = await mkdtemp(join(tmpdir(), "workspace-import-"));
  });

  afterEach(async () => {
    await pool.end();
    await rm(tempDir, { force: true, recursive: true });
  });

  it("imports the legacy JSON workspace into a PostgreSQL owner workspace", async () => {
    const workspace = createDefaultWorkspace(1000);
    const filePath = join(tempDir, "workspace.json");
    await writeFile(filePath, JSON.stringify(workspace), "utf8");

    const result = await importWorkspaceFromFile(pool, {
      displayName: "迁移管理员",
      email: "migration@example.com",
      filePath,
    });

    expect(result).toMatchObject({
      documentCount: workspace.documents.length,
      user: { displayName: "迁移管理员", email: "migration@example.com" },
    });
    const store = new PostgresWorkspaceStore(pool);
    await expect(store.loadWorkspace(result.user.id)).resolves.toMatchObject({ workspace });
  });

  it("rejects an invalid legacy workspace before writing database rows", async () => {
    const filePath = join(tempDir, "invalid.json");
    await writeFile(filePath, JSON.stringify({ documents: [] }), "utf8");

    await expect(
      importWorkspaceFromFile(pool, {
        displayName: "迁移管理员",
        email: "migration@example.com",
        filePath,
      }),
    ).rejects.toThrow("工作区数据格式不正确");

    const users = await pool.query("SELECT id FROM app_users");
    expect(users.rowCount).toBe(0);
  });
});
