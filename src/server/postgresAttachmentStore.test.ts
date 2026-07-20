import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgMemPool } from "../test/pgMemDatabase";
import { migrateDatabase } from "./database/migrations";
import { PostgresAttachmentStore } from "./postgresAttachmentStore";

describe("PostgresAttachmentStore", () => {
  let pool: Pool;
  let store: PostgresAttachmentStore;

  beforeEach(async () => {
    pool = createPgMemPool();
    await migrateDatabase(pool);
    store = new PostgresAttachmentStore(pool);
    await pool.query(
      `INSERT INTO app_users (id, email, display_name, created_at)
       VALUES ('owner-1', 'owner@example.com', 'Owner', 1000)`,
    );
    await pool.query(
      `INSERT INTO editor_workspaces (id, name, updated_at, created_at)
       VALUES ('workspace-1', 'Workspace', 1000, 1000)`,
    );
    await pool.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
       VALUES ('workspace-1', 'owner-1', 'owner', 1000)`,
    );
    await pool.query(
      `INSERT INTO editor_documents
         (workspace_id, id, public_id, created_by, access_mode, title, position, updated_at)
       VALUES ('workspace-1', 'document-1', 'public-document-1', 'owner-1', 'private', 'Private', 0, 1000)`,
    );
  });

  afterEach(async () => {
    await pool.end();
  });

  it("maps an object key to one workspace-scoped document", async () => {
    await store.createAttachment({
      documentId: "document-1",
      key: "workspace-1/object-1.pdf",
      workspaceId: "workspace-1",
    });

    await expect(store.findAttachment("workspace-1/object-1.pdf")).resolves.toEqual({
      documentId: "document-1",
      key: "workspace-1/object-1.pdf",
      workspaceId: "workspace-1",
    });
  });
});
