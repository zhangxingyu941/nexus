import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrations";

describe("authentication database migration", () => {
  let pool: Pool;

  beforeEach(() => {
    const memoryDatabase = newDb({
      autoCreateForeignKeyIndices: true,
      noAstCoverageCheck: true,
    });
    const adapter = memoryDatabase.adapters.createPg();
    pool = new adapter.Pool() as Pool;
    installPgMemColumnSpecificSetNullEmulation(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("adds nullable credentials to users and preserves legacy identities", async () => {
    await migrateDatabase(pool);
    await pool.query(
      "INSERT INTO app_users (id, email, display_name, created_at) VALUES ($1, $2, $3, $4)",
      ["legacy-user", "legacy@example.com", "Legacy User", 1000],
    );

    const result = await pool.query(
      `SELECT id, password_hash, email_verified_at, updated_at
       FROM app_users
       WHERE id = $1`,
      ["legacy-user"],
    );

    expect(result.rows).toEqual([{
      email_verified_at: null,
      id: "legacy-user",
      password_hash: null,
      updated_at: null,
    }]);
  });

  it("creates OAuth, one-time token, and audit tables under one recorded migration", async () => {
    await migrateDatabase(pool);

    const tables = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('oauth_accounts', 'auth_tokens', 'auth_audit_events')
       ORDER BY table_name`,
    );
    const migration = await pool.query(
      "SELECT COUNT(*)::int AS count FROM schema_migrations WHERE id = $1",
      ["2026-07-13-production-authentication"],
    );

    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "auth_audit_events",
      "auth_tokens",
      "oauth_accounts",
    ]);
    expect(Number(migration.rows[0].count)).toBe(1);
  });

  it("enforces provider account uniqueness", async () => {
    await migrateDatabase(pool);
    await pool.query(
      "INSERT INTO app_users (id, email, display_name, created_at) VALUES ($1, $2, $3, $4)",
      ["user-1", "first@example.com", "First", 1000],
    );
    await pool.query(
      "INSERT INTO app_users (id, email, display_name, created_at) VALUES ($1, $2, $3, $4)",
      ["user-2", "second@example.com", "Second", 1000],
    );
    await pool.query(
      `INSERT INTO oauth_accounts
       (provider, provider_account_id, user_id, provider_email, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      ["github", "github-42", "user-1", "first@example.com", 1000],
    );

    await expect(pool.query(
      `INSERT INTO oauth_accounts
       (provider, provider_account_id, user_id, provider_email, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      ["github", "github-42", "user-2", "second@example.com", 1000],
    )).rejects.toThrow();
  });

  it("creates workspace-scoped Yjs snapshot and ordered update tables", async () => {
    await migrateDatabase(pool);

    const tables = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('yjs_room_snapshots', 'yjs_room_updates')
       ORDER BY table_name`,
    );
    const migration = await pool.query(
      "SELECT COUNT(*)::int AS count FROM schema_migrations WHERE id = $1",
      ["2026-07-13-yjs-persistence"],
    );

    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "yjs_room_snapshots",
      "yjs_room_updates",
    ]);
    expect(Number(migration.rows[0].count)).toBe(1);
  });

  it("migrates shared active documents to per-member preferences idempotently", async () => {
    await createLegacyMultiWorkspaceFixture(pool);

    await migrateDatabase(pool);
    await migrateDatabase(pool);

    const workspaceColumns = await columnNames(pool, "editor_workspaces");
    const workspacePreferenceColumns = await columnNames(pool, "workspace_preferences");
    const documentPreferences = await pool.query(
      `SELECT user_id, workspace_id, active_document_id
       FROM workspace_document_preferences
       ORDER BY user_id`,
    );

    expect(workspaceColumns).not.toContain("owner_id");
    expect(workspaceColumns).not.toContain("active_document_id");
    expect(workspacePreferenceColumns).toContain("selected_workspace_id");
    expect(documentPreferences.rows).toEqual([
      {
        active_document_id: "document-1",
        user_id: "member-1",
        workspace_id: "workspace-1",
      },
      {
        active_document_id: "document-1",
        user_id: "owner-1",
        workspace_id: "workspace-1",
      },
    ]);

    await pool.query(
      "DELETE FROM editor_documents WHERE workspace_id = $1 AND id = $2",
      ["workspace-1", "document-1"],
    );
    const preferencesAfterDelete = await pool.query(
      `SELECT document_preferences.user_id,
              preferences.selected_workspace_id,
              document_preferences.active_document_id
       FROM workspace_document_preferences document_preferences
       INNER JOIN workspace_preferences preferences USING (user_id)
       ORDER BY document_preferences.user_id`,
    );

    expect(preferencesAfterDelete.rows).toEqual([
      {
        active_document_id: null,
        selected_workspace_id: "workspace-1",
        user_id: "member-1",
      },
      {
        active_document_id: null,
        selected_workspace_id: "workspace-1",
        user_id: "owner-1",
      },
    ]);
  });
});

async function createLegacyMultiWorkspaceFixture(pool: Pool) {
  const statements = [
    `CREATE TABLE app_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )`,
    `CREATE TABLE schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at BIGINT NOT NULL
    )`,
    `CREATE TABLE editor_workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id TEXT NOT NULL REFERENCES app_users(id),
      active_document_id TEXT,
      updated_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    )`,
    `CREATE TABLE workspace_members (
      workspace_id TEXT NOT NULL REFERENCES editor_workspaces(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
      created_at BIGINT NOT NULL,
      PRIMARY KEY (workspace_id, user_id)
    )`,
    `CREATE TABLE workspace_preferences (
      user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES editor_workspaces(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE editor_documents (
      id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL REFERENCES editor_workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      template_id TEXT,
      pinned BOOLEAN,
      position INTEGER NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (workspace_id, id)
    )`,
  ];

  for (const statement of statements) {
    await pool.query(statement);
  }

  await pool.query(
    `INSERT INTO schema_migrations (id, applied_at)
     VALUES
       ('__migration_lock__', 0),
       ('2026-07-10-workspace-scoped-content-keys', 1000),
       ('2026-07-10-complex-block-data', 1000),
       ('2026-07-13-production-authentication', 1000),
       ('2026-07-13-yjs-persistence', 1000)`,
  );
  await pool.query(
    `INSERT INTO app_users (id, email, display_name, created_at)
     VALUES
       ('owner-1', 'owner@example.com', 'Owner', 1000),
       ('member-1', 'member@example.com', 'Member', 1000)`,
  );
  await pool.query(
    `INSERT INTO editor_workspaces
       (id, name, owner_id, active_document_id, updated_at, created_at)
     VALUES ('workspace-1', 'Legacy workspace', 'owner-1', 'document-1', 2000, 1000)`,
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
     VALUES
       ('workspace-1', 'owner-1', 'owner', 1000),
       ('workspace-1', 'member-1', 'editor', 1000)`,
  );
  await pool.query(
    `INSERT INTO editor_documents
       (id, workspace_id, title, template_id, pinned, position, updated_at)
     VALUES ('document-1', 'workspace-1', 'Legacy document', NULL, NULL, 0, 2000)`,
  );
  await pool.query(
    `INSERT INTO workspace_preferences (user_id, workspace_id)
     VALUES
       ('owner-1', 'workspace-1'),
       ('member-1', 'workspace-1')`,
  );
}

async function columnNames(pool: Pool, tableName: string) {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName],
  );
  return result.rows.map((row) => String(row.column_name));
}

function installPgMemColumnSpecificSetNullEmulation(pool: Pool) {
  const query = pool.query.bind(pool) as (
    text: string,
    values?: unknown[],
  ) => Promise<unknown>;

  pool.query = (async (text: string, values?: unknown[]) => {
    if (text.trimStart().startsWith("DELETE FROM editor_documents")) {
      await query(
        `UPDATE workspace_document_preferences
         SET active_document_id = NULL
         WHERE workspace_id = $1 AND active_document_id = $2`,
        values,
      );
    }

    return query(text, values);
  }) as Pool["query"];
}
