import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

const INITIAL_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS app_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS editor_workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES app_users(id),
    active_document_id TEXT,
    updated_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id TEXT NOT NULL REFERENCES editor_workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    created_at BIGINT NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_preferences (
    user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES editor_workspaces(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS editor_documents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES editor_workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    template_id TEXT,
    pinned BOOLEAN,
    position INTEGER NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS document_versions (
    workspace_id TEXT NOT NULL REFERENCES editor_workspaces(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    title TEXT NOT NULL,
    snapshot JSONB NOT NULL,
    snapshot_hash TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (workspace_id, id)
  )`,
  `CREATE TABLE IF NOT EXISTS editor_blocks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL CONSTRAINT editor_blocks_document_id_fkey REFERENCES editor_documents(id) ON DELETE CASCADE,
    type TEXT NOT NULL CONSTRAINT editor_blocks_type_check CHECK (type IN ('paragraph', 'heading', 'todo', 'quote', 'code')),
    content TEXT NOT NULL,
    checked BOOLEAN NOT NULL,
    assignee TEXT NOT NULL,
    due_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('unset', 'todo', 'in-progress', 'review', 'done')),
    parent_id TEXT,
    position INTEGER NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS block_relationships (
    parent_block_id TEXT NOT NULL CONSTRAINT block_relationships_parent_block_id_fkey REFERENCES editor_blocks(id) ON DELETE CASCADE,
    child_block_id TEXT NOT NULL CONSTRAINT block_relationships_child_block_id_fkey REFERENCES editor_blocks(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (parent_block_id, child_block_id)
  )`,
  `CREATE TABLE IF NOT EXISTS block_comments (
    id TEXT PRIMARY KEY,
    block_id TEXT NOT NULL CONSTRAINT block_comments_block_id_fkey REFERENCES editor_blocks(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    time_label TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    resolved BOOLEAN NOT NULL,
    resolved_at BIGINT
  )`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members(user_id)",
  "CREATE INDEX IF NOT EXISTS editor_documents_workspace_idx ON editor_documents(workspace_id, position)",
  "CREATE INDEX IF NOT EXISTS document_versions_document_idx ON document_versions(workspace_id, document_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS editor_blocks_document_idx ON editor_blocks(document_id, position)",
  "CREATE INDEX IF NOT EXISTS block_comments_block_idx ON block_comments(block_id, created_at)",
  "CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id)",
];

const WORKSPACE_SCOPED_CONTENT_MIGRATION_ID = "2026-07-10-workspace-scoped-content-keys";
const COMPLEX_BLOCK_DATA_MIGRATION_ID = "2026-07-10-complex-block-data";
const PRODUCTION_AUTHENTICATION_MIGRATION_ID = "2026-07-13-production-authentication";
const YJS_PERSISTENCE_MIGRATION_ID = "2026-07-13-yjs-persistence";
const MULTI_WORKSPACE_FOUNDATION_MIGRATION_ID = "2026-07-15-multi-workspace-foundation";
const ORPHANED_USER_WORKSPACES_MIGRATION_ID = "2026-07-16-orphaned-user-workspaces";
const WORKSPACE_INVITATIONS_AUDIT_MIGRATION_ID =
  "2026-07-16-workspace-invitations-audit";
const HEADING_LEVEL_MIGRATION_ID = "2026-07-17-editor-heading-level";
const WORKSPACE_SOFT_DELETION_MIGRATION_ID =
  "2026-07-16-workspace-soft-deletion";
const DOCUMENT_PERMISSIONS_MIGRATION_ID = "2026-07-20-document-permissions";
const DOCUMENT_PUBLIC_ID_MIGRATION_ID = "2026-07-20-document-public-id";
const DOCUMENT_ATTACHMENTS_MIGRATION_ID = "2026-07-20-document-attachments";
const DOCUMENT_SHARE_LINKS_MIGRATION_ID = "2026-07-21-document-share-links";
const STRUCTURED_RICH_TEXT_MIGRATION_ID = "2026-07-22-structured-rich-text";
const DOCUMENT_ATTACHMENT_RESERVATIONS_MIGRATION_ID =
  "2026-07-22-document-attachment-reservations";
const EDITOR_BLOCK_TYPES_MIGRATION_ID = "2026-07-23-editor-block-types";
const MIGRATION_LOCK_ID = "__migration_lock__";

const WORKSPACE_SCOPED_CONTENT_SCHEMA = [
  "ALTER TABLE editor_blocks ADD COLUMN workspace_id TEXT",
  "ALTER TABLE block_relationships ADD COLUMN workspace_id TEXT",
  "ALTER TABLE block_comments ADD COLUMN workspace_id TEXT",
  `UPDATE editor_blocks
   SET workspace_id = editor_documents.workspace_id
   FROM editor_documents
   WHERE document_id = editor_documents.id`,
  `UPDATE block_relationships
   SET workspace_id = editor_blocks.workspace_id
   FROM editor_blocks
   WHERE parent_block_id = editor_blocks.id`,
  `UPDATE block_comments
   SET workspace_id = editor_blocks.workspace_id
   FROM editor_blocks
   WHERE block_id = editor_blocks.id`,
  "ALTER TABLE editor_blocks ALTER COLUMN workspace_id SET NOT NULL",
  "ALTER TABLE block_relationships ALTER COLUMN workspace_id SET NOT NULL",
  "ALTER TABLE block_comments ALTER COLUMN workspace_id SET NOT NULL",
  "ALTER TABLE block_relationships DROP CONSTRAINT block_relationships_parent_block_id_fkey",
  "ALTER TABLE block_relationships DROP CONSTRAINT block_relationships_child_block_id_fkey",
  "ALTER TABLE block_comments DROP CONSTRAINT block_comments_block_id_fkey",
  "ALTER TABLE editor_blocks DROP CONSTRAINT editor_blocks_document_id_fkey",
  "ALTER TABLE block_relationships DROP CONSTRAINT block_relationships_pkey",
  "ALTER TABLE block_comments DROP CONSTRAINT block_comments_pkey",
  "ALTER TABLE editor_blocks DROP CONSTRAINT editor_blocks_pkey",
  "ALTER TABLE editor_documents DROP CONSTRAINT editor_documents_pkey",
  "ALTER TABLE editor_documents ADD PRIMARY KEY (workspace_id, id)",
  "ALTER TABLE editor_blocks ADD PRIMARY KEY (workspace_id, id)",
  "ALTER TABLE block_relationships ADD PRIMARY KEY (workspace_id, parent_block_id, child_block_id)",
  "ALTER TABLE block_comments ADD PRIMARY KEY (workspace_id, id)",
  `ALTER TABLE editor_blocks
   ADD CONSTRAINT editor_blocks_document_fkey
   FOREIGN KEY (workspace_id, document_id)
   REFERENCES editor_documents(workspace_id, id)
   ON DELETE CASCADE`,
  `ALTER TABLE block_relationships
   ADD CONSTRAINT block_relationships_parent_fkey
   FOREIGN KEY (workspace_id, parent_block_id)
   REFERENCES editor_blocks(workspace_id, id)
   ON DELETE CASCADE`,
  `ALTER TABLE block_relationships
   ADD CONSTRAINT block_relationships_child_fkey
   FOREIGN KEY (workspace_id, child_block_id)
   REFERENCES editor_blocks(workspace_id, id)
   ON DELETE CASCADE`,
  `ALTER TABLE block_comments
   ADD CONSTRAINT block_comments_block_fkey
   FOREIGN KEY (workspace_id, block_id)
   REFERENCES editor_blocks(workspace_id, id)
   ON DELETE CASCADE`,
  "DROP INDEX IF EXISTS editor_blocks_document_idx",
  "DROP INDEX IF EXISTS block_comments_block_idx",
  "CREATE INDEX editor_blocks_document_idx ON editor_blocks(workspace_id, document_id, position)",
  "CREATE INDEX block_comments_block_idx ON block_comments(workspace_id, block_id, created_at)",
  "CREATE INDEX block_relationships_child_idx ON block_relationships(workspace_id, child_block_id)",
];

const COMPLEX_BLOCK_DATA_SCHEMA = [
  "ALTER TABLE editor_blocks ADD COLUMN data JSONB",
  "ALTER TABLE editor_blocks DROP CONSTRAINT editor_blocks_type_check",
  `ALTER TABLE editor_blocks
   ADD CONSTRAINT editor_blocks_type_check
   CHECK (type IN ('paragraph', 'heading', 'todo', 'quote', 'code', 'image', 'file', 'table', 'kanban'))`,
];

const PRODUCTION_AUTHENTICATION_SCHEMA = [
  "ALTER TABLE app_users ADD COLUMN password_hash TEXT",
  "ALTER TABLE app_users ADD COLUMN email_verified_at BIGINT",
  "ALTER TABLE app_users ADD COLUMN updated_at BIGINT",
  `CREATE TABLE oauth_accounts (
    provider TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    provider_email TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT,
    PRIMARY KEY (provider, provider_account_id),
    UNIQUE (provider, user_id)
  )`,
  `CREATE TABLE auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('verify-email', 'reset-password')),
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    consumed_at BIGINT
  )`,
  `CREATE TABLE auth_audit_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,
    ip_hash TEXT NOT NULL,
    succeeded BOOLEAN NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  "CREATE INDEX auth_tokens_user_purpose_idx ON auth_tokens(user_id, purpose, expires_at)",
  "CREATE INDEX auth_audit_events_user_created_idx ON auth_audit_events(user_id, created_at DESC)",
];

const YJS_PERSISTENCE_SCHEMA = [
  `CREATE TABLE yjs_room_snapshots (
    workspace_id TEXT NOT NULL REFERENCES editor_workspaces(id) ON DELETE CASCADE,
    room_name TEXT NOT NULL,
    snapshot TEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (workspace_id, room_name)
  )`,
  `CREATE TABLE yjs_room_updates (
    id BIGSERIAL PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES editor_workspaces(id) ON DELETE CASCADE,
    room_name TEXT NOT NULL,
    update_data TEXT NOT NULL,
    byte_length INTEGER NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  "CREATE INDEX yjs_room_snapshots_room_idx ON yjs_room_snapshots(room_name)",
  "CREATE INDEX yjs_room_updates_room_idx ON yjs_room_updates(workspace_id, room_name, id)",
];

const MULTI_WORKSPACE_FOUNDATION_SCHEMA = [
  `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
   SELECT id, owner_id, 'owner', created_at
   FROM editor_workspaces
   ON CONFLICT (workspace_id, user_id) DO NOTHING`,
  `CREATE TABLE workspace_document_preferences (
    user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES editor_workspaces(id) ON DELETE CASCADE,
    active_document_id TEXT,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, workspace_id),
    FOREIGN KEY (workspace_id, user_id)
      REFERENCES workspace_members(workspace_id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, active_document_id)
      REFERENCES editor_documents(workspace_id, id)
      ON DELETE SET NULL (active_document_id)
  )`,
  `INSERT INTO workspace_document_preferences
    (user_id, workspace_id, active_document_id, updated_at)
   SELECT members.user_id, members.workspace_id, workspaces.active_document_id, workspaces.updated_at
   FROM workspace_members members
   INNER JOIN editor_workspaces workspaces ON workspaces.id = members.workspace_id
   ON CONFLICT (user_id, workspace_id) DO NOTHING`,
  "ALTER TABLE workspace_preferences RENAME COLUMN workspace_id TO selected_workspace_id",
  "ALTER TABLE editor_workspaces DROP COLUMN owner_id",
  "ALTER TABLE editor_workspaces DROP COLUMN active_document_id",
  `CREATE INDEX workspace_document_preferences_workspace_idx
   ON workspace_document_preferences(workspace_id, user_id)`,
];

const WORKSPACE_INVITATIONS_AUDIT_SCHEMA = [
  "CREATE TABLE workspace_audit_events ("
    + "id TEXT PRIMARY KEY,"
    + "workspace_id TEXT NOT NULL,"
    + "workspace_name TEXT NOT NULL,"
    + "actor_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL,"
    + "event_type TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,"
    + "metadata JSONB NOT NULL,created_at BIGINT NOT NULL)",
  "CREATE TABLE workspace_invites ("
    + "id TEXT PRIMARY KEY,"
    + "workspace_id TEXT NOT NULL REFERENCES editor_workspaces(id) ON DELETE CASCADE,"
    + "email TEXT NOT NULL,"
    + "role TEXT NOT NULL CHECK (role IN ('editor','viewer')),"
    + "token_hash TEXT NOT NULL UNIQUE,"
    + "status TEXT NOT NULL CHECK (status IN ('pending','accepted','declined','revoked','expired')),"
    + "delivery_status TEXT NOT NULL CHECK (delivery_status IN ('pending','sent','failed')),"
    + "invited_by TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,"
    + "accepted_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,"
    + "declined_by TEXT REFERENCES app_users(id) ON DELETE SET NULL,"
    + "created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL,expires_at BIGINT NOT NULL,"
    + "last_delivery_attempt_at BIGINT,last_sent_at BIGINT,accepted_at BIGINT,"
    + "declined_at BIGINT,revoked_at BIGINT)",
  "CREATE UNIQUE INDEX workspace_invites_pending_email_idx "
    + "ON workspace_invites(workspace_id,email) WHERE status='pending'",
  "CREATE INDEX workspace_invites_recipient_idx "
    + "ON workspace_invites(email,status,expires_at)",
  "CREATE INDEX workspace_invites_workspace_history_idx "
    + "ON workspace_invites(workspace_id,created_at DESC)",
  "CREATE INDEX workspace_audit_events_workspace_idx "
    + "ON workspace_audit_events(workspace_id,created_at DESC)",
];

const HEADING_LEVEL_SCHEMA = [
  `ALTER TABLE editor_blocks
   ADD COLUMN heading_level INTEGER NOT NULL DEFAULT 1
   CHECK (heading_level BETWEEN 1 AND 6)`,
];

const WORKSPACE_SOFT_DELETION_SCHEMA = [
  "ALTER TABLE editor_workspaces ADD COLUMN deleted_at BIGINT",
  "ALTER TABLE editor_workspaces ADD COLUMN deleted_by TEXT REFERENCES app_users(id) ON DELETE SET NULL",
  "ALTER TABLE editor_workspaces ADD COLUMN purge_after BIGINT",
  `ALTER TABLE editor_workspaces
   ADD CONSTRAINT editor_workspaces_tombstone_check
   CHECK (
     (deleted_at IS NULL AND purge_after IS NULL)
     OR (deleted_at IS NOT NULL AND purge_after = deleted_at + 604800000)
   )`,
  `CREATE INDEX editor_workspaces_purge_after_idx
   ON editor_workspaces(purge_after)
   WHERE deleted_at IS NOT NULL`,
];

const DOCUMENT_PERMISSIONS_SCHEMA = [
  "ALTER TABLE editor_documents ADD COLUMN created_by TEXT",
  "ALTER TABLE editor_documents ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'workspace' CHECK (access_mode IN ('workspace', 'private', 'link'))",
];

const DOCUMENT_PERMISSIONS_FINAL_SCHEMA = [
  "ALTER TABLE editor_documents ALTER COLUMN created_by SET NOT NULL",
  `ALTER TABLE editor_documents
   ADD CONSTRAINT editor_documents_created_by_fkey
   FOREIGN KEY (created_by) REFERENCES app_users(id)`,
  `CREATE TABLE document_permissions (
    workspace_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
    created_by TEXT NOT NULL REFERENCES app_users(id),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (workspace_id, document_id, user_id),
    FOREIGN KEY (workspace_id, document_id)
      REFERENCES editor_documents(workspace_id, id)
      ON DELETE CASCADE
  )`,
  "CREATE INDEX document_permissions_user_idx ON document_permissions(user_id, workspace_id, document_id)",
];

const DOCUMENT_PUBLIC_ID_SCHEMA = [
  "ALTER TABLE editor_documents ADD COLUMN public_id TEXT",
];

const DOCUMENT_PUBLIC_ID_FINAL_SCHEMA = [
  "ALTER TABLE editor_documents ALTER COLUMN public_id SET NOT NULL",
  "ALTER TABLE editor_documents ADD CONSTRAINT editor_documents_public_id_key UNIQUE (public_id)",
];

const DOCUMENT_ATTACHMENTS_SCHEMA = [
  `CREATE TABLE document_attachments (
    object_key TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    FOREIGN KEY (workspace_id, document_id)
      REFERENCES editor_documents(workspace_id, id)
      ON DELETE CASCADE
  )`,
  "CREATE INDEX document_attachments_document_idx ON document_attachments(workspace_id, document_id)",
];

const DOCUMENT_SHARE_LINKS_SCHEMA = [
  `CREATE TABLE document_share_links (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
    expires_at BIGINT NOT NULL,
    revoked_at BIGINT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    FOREIGN KEY (workspace_id, document_id)
      REFERENCES editor_documents(workspace_id, id)
      ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX document_share_links_active_document_idx
   ON document_share_links(workspace_id, document_id)
   WHERE revoked_at IS NULL`,
  `CREATE INDEX document_share_links_document_history_idx
   ON document_share_links(workspace_id, document_id, created_at DESC)`,
];

const STRUCTURED_RICH_TEXT_SCHEMA = [
  "ALTER TABLE editor_blocks ADD COLUMN rich_text JSONB",
];

const DOCUMENT_ATTACHMENT_RESERVATIONS_SCHEMA = [
  "ALTER TABLE document_attachments ADD COLUMN cleanup_pending BOOLEAN NOT NULL DEFAULT FALSE",
];

const EDITOR_BLOCK_TYPES_SCHEMA = [
  "ALTER TABLE editor_blocks DROP CONSTRAINT editor_blocks_type_check",
  `ALTER TABLE editor_blocks
   ADD CONSTRAINT editor_blocks_type_check
   CHECK (type IN (
     'paragraph', 'heading', 'todo', 'quote', 'code',
     'image', 'file', 'table', 'kanban', 'divider',
     'bulletedList', 'numberedList', 'toggle', 'formula', 'linkCard'
   ))`,
];

async function migrateDocumentPermissions(client: PoolClient) {
  for (const statement of DOCUMENT_PERMISSIONS_SCHEMA) {
    await client.query(statement);
  }

  const documents = await client.query(
    `SELECT workspace_id, id
     FROM editor_documents
     WHERE created_by IS NULL`,
  );

  for (const document of documents.rows) {
    const workspaceId = String(document.workspace_id);
    const documentId = String(document.id);
    const owner = await client.query(
      `SELECT user_id
       FROM workspace_members
       WHERE workspace_id = $1 AND role = 'owner'
       ORDER BY created_at ASC, user_id ASC
       LIMIT 1`,
      [workspaceId],
    );
    const ownerId = owner.rows[0]?.user_id;

    if (!ownerId) {
      throw new Error(`Cannot backfill document author for workspace ${workspaceId}`);
    }

    await client.query(
      `UPDATE editor_documents
       SET created_by = $1
       WHERE workspace_id = $2 AND id = $3`,
      [String(ownerId), workspaceId, documentId],
    );
  }

  for (const statement of DOCUMENT_PERMISSIONS_FINAL_SCHEMA) {
    await client.query(statement);
  }
}

async function migrateDocumentPublicIds(client: PoolClient) {
  for (const statement of DOCUMENT_PUBLIC_ID_SCHEMA) {
    await client.query(statement);
  }

  const documents = await client.query(
    `SELECT workspace_id, id
     FROM editor_documents
     WHERE public_id IS NULL`,
  );

  for (const document of documents.rows) {
    await client.query(
      `UPDATE editor_documents
       SET public_id = $1
       WHERE workspace_id = $2 AND id = $3`,
      [
        `document-${randomUUID()}`,
        String(document.workspace_id),
        String(document.id),
      ],
    );
  }

  for (const statement of DOCUMENT_PUBLIC_ID_FINAL_SCHEMA) {
    await client.query(statement);
  }
}

export async function migrateDatabase(pool: Pool) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    for (const statement of INITIAL_SCHEMA) {
      await client.query(statement);
    }

    await client.query(
      `INSERT INTO schema_migrations (id, applied_at)
       VALUES ($1, 0)
       ON CONFLICT (id) DO NOTHING`,
      [MIGRATION_LOCK_ID],
    );
    await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1 FOR UPDATE",
      [MIGRATION_LOCK_ID],
    );

    const migrationResult = await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [WORKSPACE_SCOPED_CONTENT_MIGRATION_ID],
    );

    if (migrationResult.rows.length === 0) {
      for (const statement of WORKSPACE_SCOPED_CONTENT_SCHEMA) {
        await client.query(statement);
      }

      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
        [WORKSPACE_SCOPED_CONTENT_MIGRATION_ID, Date.now()],
      );
    }

    const complexBlockMigrationResult = await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [COMPLEX_BLOCK_DATA_MIGRATION_ID],
    );

    if (complexBlockMigrationResult.rows.length === 0) {
      for (const statement of COMPLEX_BLOCK_DATA_SCHEMA) {
        await client.query(statement);
      }

      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
        [COMPLEX_BLOCK_DATA_MIGRATION_ID, Date.now()],
      );
    }

    const productionAuthenticationResult = await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [PRODUCTION_AUTHENTICATION_MIGRATION_ID],
    );

    if (productionAuthenticationResult.rows.length === 0) {
      for (const statement of PRODUCTION_AUTHENTICATION_SCHEMA) {
        await client.query(statement);
      }

      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
        [PRODUCTION_AUTHENTICATION_MIGRATION_ID, Date.now()],
      );
    }

    const yjsPersistenceResult = await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [YJS_PERSISTENCE_MIGRATION_ID],
    );

    if (yjsPersistenceResult.rows.length === 0) {
      for (const statement of YJS_PERSISTENCE_SCHEMA) {
        await client.query(statement);
      }

      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
        [YJS_PERSISTENCE_MIGRATION_ID, Date.now()],
      );
    }

    const multiWorkspaceFoundationResult = await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [MULTI_WORKSPACE_FOUNDATION_MIGRATION_ID],
    );

    if (multiWorkspaceFoundationResult.rows.length === 0) {
      for (const statement of MULTI_WORKSPACE_FOUNDATION_SCHEMA) {
        await client.query(statement);
      }

      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
        [MULTI_WORKSPACE_FOUNDATION_MIGRATION_ID, Date.now()],
      );
    }

    const orphanedUserWorkspacesResult = await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [ORPHANED_USER_WORKSPACES_MIGRATION_ID],
    );

    if (orphanedUserWorkspacesResult.rows.length === 0) {
      const orphanedUsers = await client.query(
        `SELECT users.id, users.display_name
         FROM app_users users
         LEFT JOIN workspace_members members ON members.user_id = users.id
         WHERE members.user_id IS NULL
         ORDER BY users.created_at ASC, users.id ASC`,
      );

      for (const user of orphanedUsers.rows) {
        const userId = String(user.id);
        const displayName = String(user.display_name).trim();
        const workspaceId = `workspace-${randomUUID()}`;
        const now = Date.now();

        await client.query(
          `INSERT INTO editor_workspaces (id, name, updated_at, created_at)
           VALUES ($1, $2, $3, $3)`,
          [workspaceId, displayName ? `${displayName}的工作区` : "我的工作区", now],
        );
        await client.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
           VALUES ($1, $2, 'owner', $3)`,
          [workspaceId, userId, now],
        );
        await client.query(
          `INSERT INTO workspace_preferences (user_id, selected_workspace_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id) DO UPDATE
           SET selected_workspace_id = EXCLUDED.selected_workspace_id`,
          [userId, workspaceId],
        );
      }

      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
        [ORPHANED_USER_WORKSPACES_MIGRATION_ID, Date.now()],
      );
    }

    const workspaceInvitationsAuditResult = await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [WORKSPACE_INVITATIONS_AUDIT_MIGRATION_ID],
    );

    if (workspaceInvitationsAuditResult.rows.length === 0) {
      for (const statement of WORKSPACE_INVITATIONS_AUDIT_SCHEMA) {
        await client.query(statement);
      }

      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
        [WORKSPACE_INVITATIONS_AUDIT_MIGRATION_ID, Date.now()],
      );
    }

    const headingLevelResult = await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [HEADING_LEVEL_MIGRATION_ID],
    );

    if (headingLevelResult.rows.length === 0) {
      for (const statement of HEADING_LEVEL_SCHEMA) {
        await client.query(statement);
      }

      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
        [HEADING_LEVEL_MIGRATION_ID, Date.now()],
      );
    }

    const workspaceSoftDeletionResult = await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [WORKSPACE_SOFT_DELETION_MIGRATION_ID],
    );

    if (workspaceSoftDeletionResult.rows.length === 0) {
      for (const statement of WORKSPACE_SOFT_DELETION_SCHEMA) {
        await client.query(statement);
      }

      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
        [WORKSPACE_SOFT_DELETION_MIGRATION_ID, Date.now()],
      );
    }

    const documentPermissionsResult = await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [DOCUMENT_PERMISSIONS_MIGRATION_ID],
    );

    if (documentPermissionsResult.rows.length === 0) {
      await migrateDocumentPermissions(client);

      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
        [DOCUMENT_PERMISSIONS_MIGRATION_ID, Date.now()],
      );
    }

    const documentPublicIdResult = await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [DOCUMENT_PUBLIC_ID_MIGRATION_ID],
    );

    if (documentPublicIdResult.rows.length === 0) {
      await migrateDocumentPublicIds(client);

      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
        [DOCUMENT_PUBLIC_ID_MIGRATION_ID, Date.now()],
      );
    }

    const documentAttachmentsResult = await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [DOCUMENT_ATTACHMENTS_MIGRATION_ID],
    );

    if (documentAttachmentsResult.rows.length === 0) {
      for (const statement of DOCUMENT_ATTACHMENTS_SCHEMA) {
        await client.query(statement);
      }

      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
        [DOCUMENT_ATTACHMENTS_MIGRATION_ID, Date.now()],
      );
    }

    const documentShareLinksResult = await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [DOCUMENT_SHARE_LINKS_MIGRATION_ID],
    );

    if (documentShareLinksResult.rows.length === 0) {
      for (const statement of DOCUMENT_SHARE_LINKS_SCHEMA) {
        await client.query(statement);
      }

      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
        [DOCUMENT_SHARE_LINKS_MIGRATION_ID, Date.now()],
      );
    }

    const structuredRichTextResult = await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [STRUCTURED_RICH_TEXT_MIGRATION_ID],
    );

    if (structuredRichTextResult.rows.length === 0) {
      for (const statement of STRUCTURED_RICH_TEXT_SCHEMA) {
        await client.query(statement);
      }

      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
        [STRUCTURED_RICH_TEXT_MIGRATION_ID, Date.now()],
      );
    }

    const documentAttachmentReservationsResult = await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [DOCUMENT_ATTACHMENT_RESERVATIONS_MIGRATION_ID],
    );

    if (documentAttachmentReservationsResult.rows.length === 0) {
      for (const statement of DOCUMENT_ATTACHMENT_RESERVATIONS_SCHEMA) {
        await client.query(statement);
      }

      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
        [DOCUMENT_ATTACHMENT_RESERVATIONS_MIGRATION_ID, Date.now()],
      );
    }

    const editorBlockTypesResult = await client.query(
      "SELECT id FROM schema_migrations WHERE id = $1",
      [EDITOR_BLOCK_TYPES_MIGRATION_ID],
    );

    if (editorBlockTypesResult.rows.length === 0) {
      for (const statement of EDITOR_BLOCK_TYPES_SCHEMA) {
        await client.query(statement);
      }

      await client.query(
        "INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)",
        [EDITOR_BLOCK_TYPES_MIGRATION_ID, Date.now()],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
