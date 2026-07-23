import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgMemTestDatabase } from "../../test/pgMemDatabase";
import { migrateDatabase } from "./migrations";

describe("authentication database migration", () => {
  let pool: Pool;
  let translatedStatements: string[];

  beforeEach(() => {
    const database = createPgMemTestDatabase({
      noAstCoverageCheck: true,
    });
    pool = database.pool;
    translatedStatements = database.translatedStatements;
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

  it("creates workspace invites and independent audit tables idempotently", async () => {
    await migrateDatabase(pool);
    await migrateDatabase(pool);

    const tables = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('workspace_audit_events', 'workspace_invites')
       ORDER BY table_name`,
    );
    const migration = await pool.query(
      "SELECT COUNT(*)::int AS count FROM schema_migrations WHERE id = $1",
      ["2026-07-16-workspace-invitations-audit"],
    );

    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "workspace_audit_events",
      "workspace_invites",
    ]);
    expect(Number(migration.rows[0].count)).toBe(1);
  });

  it("adds constrained workspace tombstone fields", async () => {
    await migrateDatabase(pool);
    await pool.query(
      "INSERT INTO app_users (id, email, display_name, created_at) VALUES ($1, $2, $3, $4)",
      ["owner-1", "owner@example.com", "Owner", 1000],
    );
    await pool.query(
      `INSERT INTO editor_workspaces (id, name, updated_at, created_at)
       VALUES ($1, $2, $3, $4)`,
      ["workspace-1", "Workspace", 1000, 1000],
    );

    expect(await columnNames(pool, "editor_workspaces")).toEqual(expect.arrayContaining([
      "deleted_at",
      "deleted_by",
      "purge_after",
    ]));
    await expect(pool.query(
      `UPDATE editor_workspaces
       SET deleted_at = $1, deleted_by = $2, purge_after = $3
       WHERE id = $4`,
      [1000, "owner-1", 2000, "workspace-1"],
    )).rejects.toThrow();
  });

  it("backfills document authors from the earliest workspace owner and creates constrained grants", async () => {
    await createPreDocumentPermissionsFixture(pool);

    await migrateDatabase(pool);
    await migrateDatabase(pool);

    expect(await columnNames(pool, "editor_documents")).toEqual(expect.arrayContaining([
      "access_mode",
      "created_by",
      "public_id",
    ]));
    await expect(pool.query(
      `SELECT created_by, access_mode, public_id
       FROM editor_documents
       WHERE workspace_id = $1 AND id = $2`,
      ["workspace-1", "document-1"],
    )).resolves.toMatchObject({
      rows: [{
        access_mode: "workspace",
        created_by: "owner-early",
        public_id: expect.stringMatching(/^document-/),
      }],
    });
    await expect(pool.query(
      `INSERT INTO document_permissions
         (workspace_id, document_id, user_id, role, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      ["workspace-1", "document-1", "editor-1", "owner-early", "owner-early", 3000],
    )).rejects.toThrow();
    const publicId = await pool.query(
      `SELECT public_id
       FROM editor_documents
       WHERE workspace_id = $1 AND id = $2`,
      ["workspace-1", "document-1"],
    );
    await pool.query(
      `INSERT INTO editor_workspaces (id, name, deleted_at, updated_at, created_at)
       VALUES ('workspace-2', 'Second workspace', NULL, 3000, 1000)`,
    );
    await expect(pool.query(
      `INSERT INTO editor_documents
         (workspace_id, id, public_id, created_by, title, position, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      ["workspace-2", "document-2", publicId.rows[0].public_id, "owner-late", "Duplicate route", 0, 3000],
    )).rejects.toThrow();
  });

  it("creates idempotent document share link constraints", async () => {
    await migrateDatabase(pool);
    await migrateDatabase(pool);
    await pool.query(
      `INSERT INTO app_users (id, email, display_name, created_at)
       VALUES ('share-owner-1', 'share-owner@example.com', 'Share owner', 1000)`,
    );
    await pool.query(
      `INSERT INTO editor_workspaces (id, name, updated_at, created_at)
       VALUES ('share-workspace-1', 'Share workspace', 1000, 1000)`,
    );
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
       VALUES ('share-workspace-1', 'share-owner-1', 'owner', 1000)`,
    );
    await pool.query(
      `INSERT INTO editor_documents
         (workspace_id, id, public_id, created_by, access_mode, title, position, updated_at)
       VALUES
         ('share-workspace-1', 'share-document-1', 'public-share-document-1',
          'share-owner-1', 'link', 'Shared document', 0, 1000)`,
    );

    expect(await columnNames(pool, "document_share_links")).toEqual([
      "id",
      "workspace_id",
      "document_id",
      "token_hash",
      "created_by",
      "expires_at",
      "revoked_at",
      "created_at",
      "updated_at",
    ]);
    await pool.query(
      `INSERT INTO document_share_links
         (id, workspace_id, document_id, token_hash, created_by,
          expires_at, revoked_at, created_at, updated_at)
       VALUES
         ('share-1', 'share-workspace-1', 'share-document-1', 'hash-1',
          'share-owner-1', 2000, NULL, 1000, 1000)`,
    );

    await expect(pool.query(
      `INSERT INTO document_share_links
         (id, workspace_id, document_id, token_hash, created_by,
          expires_at, revoked_at, created_at, updated_at)
       VALUES
         ('share-2', 'share-workspace-1', 'share-document-1', 'hash-2',
          'share-owner-1', 3000, NULL, 1000, 1000)`,
    )).rejects.toThrow();

    await pool.query(
      "UPDATE document_share_links SET revoked_at = 1500, updated_at = 1500 WHERE id = 'share-1'",
    );
    await expect(pool.query(
      `INSERT INTO document_share_links
         (id, workspace_id, document_id, token_hash, created_by,
          expires_at, revoked_at, created_at, updated_at)
       VALUES
         ('share-2', 'share-workspace-1', 'share-document-1', 'hash-2',
          'share-owner-1', 3000, NULL, 1500, 1500)`,
    )).resolves.toMatchObject({ rowCount: 1 });

    const migration = await pool.query(
      "SELECT COUNT(*)::int AS count FROM schema_migrations WHERE id = $1",
      ["2026-07-21-document-share-links"],
    );
    expect(Number(migration.rows[0].count)).toBe(1);
  });

  it("adds nullable structured rich text without backfilling existing blocks", async () => {
    await migrateDatabase(pool);
    await pool.query(
      `INSERT INTO app_users (id, email, display_name, created_at)
       VALUES ('rich-owner', 'rich-owner@example.com', 'Rich owner', 1000)`,
    );
    await pool.query(
      `INSERT INTO editor_workspaces (id, name, updated_at, created_at)
       VALUES ('rich-workspace', 'Rich workspace', 1000, 1000)`,
    );
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
       VALUES ('rich-workspace', 'rich-owner', 'owner', 1000)`,
    );
    await pool.query(
      `INSERT INTO editor_documents
         (workspace_id, id, public_id, created_by, title, position, updated_at)
       VALUES ('rich-workspace', 'rich-document', 'public-rich-document', 'rich-owner', 'Rich', 0, 1000)`,
    );
    await pool.query(
      `INSERT INTO editor_blocks
         (workspace_id, id, document_id, type, content, checked, assignee, due_date,
          status, parent_id, position, created_at, updated_at)
       VALUES
         ('rich-workspace', 'rich-block', 'rich-document', 'paragraph', 'legacy', false, '', '',
          'unset', NULL, 0, 1000, 1000)`,
    );

    await migrateDatabase(pool);

    expect(await columnNames(pool, "editor_blocks")).toContain("rich_text");
    await expect(pool.query(
      "SELECT rich_text FROM editor_blocks WHERE workspace_id = $1 AND id = $2",
      ["rich-workspace", "rich-block"],
    )).resolves.toMatchObject({ rows: [{ rich_text: null }] });
    const migration = await pool.query(
      "SELECT COUNT(*)::int AS count FROM schema_migrations WHERE id = $1",
      ["2026-07-22-structured-rich-text"],
    );
    expect(Number(migration.rows[0].count)).toBe(1);
  });

  it("adds a durable cleanup-pending marker for attachment reservations", async () => {
    await migrateDatabase(pool);
    await migrateDatabase(pool);

    expect(await columnNames(pool, "document_attachments")).toContain("cleanup_pending");
    const migration = await pool.query(
      "SELECT COUNT(*)::int AS count FROM schema_migrations WHERE id = $1",
      ["2026-07-22-document-attachment-reservations"],
    );

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
    expect(translatedStatements).toHaveLength(1);
    expect(translatedStatements[0]).toContain(
      "ON DELETE SET NULL (active_document_id)",
    );
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

  it("provisions one personal workspace for an existing user without membership", async () => {
    await migrateDatabase(pool);
    await pool.query(
      "DELETE FROM schema_migrations WHERE id = $1",
      ["2026-07-16-orphaned-user-workspaces"],
    );
    await pool.query(
      `INSERT INTO app_users
       (id, email, display_name, password_hash, email_verified_at, updated_at, created_at)
       VALUES ($1, $2, $3, NULL, NULL, NULL, $4)`,
      ["orphan-user", "orphan@example.com", "Orphan User", 1000],
    );

    await migrateDatabase(pool);
    await migrateDatabase(pool);

    const result = await pool.query(
      `SELECT workspaces.id, workspaces.name, members.role,
              preferences.selected_workspace_id
       FROM workspace_members members
       INNER JOIN editor_workspaces workspaces ON workspaces.id = members.workspace_id
       INNER JOIN workspace_preferences preferences ON preferences.user_id = members.user_id
       WHERE members.user_id = $1`,
      ["orphan-user"],
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: expect.stringMatching(/^workspace-/),
      name: "Orphan User的工作区",
      role: "owner",
    });
    expect(result.rows[0].selected_workspace_id).toBe(result.rows[0].id);
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
     VALUES ('workspace-1', 'member-1', 'editor', 1000)`,
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

async function createPreDocumentPermissionsFixture(pool: Pool) {
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
      deleted_at BIGINT,
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
    `CREATE TABLE editor_documents (
      id TEXT NOT NULL UNIQUE,
      workspace_id TEXT NOT NULL REFERENCES editor_workspaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
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
       ('2026-07-13-yjs-persistence', 1000),
       ('2026-07-15-multi-workspace-foundation', 1000),
       ('2026-07-16-orphaned-user-workspaces', 1000),
       ('2026-07-16-workspace-invitations-audit', 1000),
       ('2026-07-17-editor-heading-level', 1000),
       ('2026-07-16-workspace-soft-deletion', 1000)`,
  );
  await pool.query(
    `INSERT INTO app_users (id, email, display_name, created_at)
     VALUES
       ('owner-early', 'early@example.com', 'Early owner', 1000),
       ('owner-late', 'late@example.com', 'Late owner', 1000),
       ('editor-1', 'editor@example.com', 'Editor', 1000)`,
  );
  await pool.query(
    `INSERT INTO editor_workspaces (id, name, deleted_at, updated_at, created_at)
     VALUES ('workspace-1', 'Workspace', NULL, 2000, 1000)`,
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
     VALUES
       ('workspace-1', 'owner-late', 'owner', 2000),
       ('workspace-1', 'owner-early', 'owner', 1000),
       ('workspace-1', 'editor-1', 'editor', 1500)`,
  );
  await pool.query(
    `INSERT INTO editor_documents (id, workspace_id, title, position, updated_at)
     VALUES ('document-1', 'workspace-1', 'Legacy document', 0, 2000)`,
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
