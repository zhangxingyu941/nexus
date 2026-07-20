import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgMemPool } from "../test/pgMemDatabase";
import { migrateDatabase } from "./database/migrations";
import {
  DocumentAuthorizationService,
  DocumentNotFoundError,
  PostgresDocumentAuthorizationRecords,
} from "./documentAuthorization";
import { PostgresDocumentStore } from "./postgresDocumentStore";

describe("PostgresDocumentStore", () => {
  let pool: Pool;
  let store: PostgresDocumentStore;

  beforeEach(async () => {
    pool = createPgMemPool();
    await migrateDatabase(pool);
    store = new PostgresDocumentStore(
      pool,
      new DocumentAuthorizationService(new PostgresDocumentAuthorizationRecords(pool)),
    );
    await seedPrivateDocument(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("loads one authorized private document by public id", async () => {
    await expect(store.loadDocument("owner-1", "public-document-1")).resolves.toMatchObject({
      access: {
        canManage: true,
        documentId: "document-1",
        publicId: "public-document-1",
        workspaceId: "workspace-1",
      },
      document: {
        blocks: [expect.objectContaining({ content: "Private content", id: "block-1" })],
        id: "document-1",
        title: "Private document",
      },
    });
  });

  it("does not disclose an ungranted private document", async () => {
    await expect(store.loadDocument("editor-1", "public-document-1"))
      .rejects.toBeInstanceOf(DocumentNotFoundError);
  });
});

async function seedPrivateDocument(pool: Pool) {
  await pool.query(
    `INSERT INTO app_users (id, email, display_name, created_at)
     VALUES
       ('owner-1', 'owner@example.com', 'Owner', 1000),
       ('author-1', 'author@example.com', 'Author', 1000),
       ('editor-1', 'editor@example.com', 'Editor', 1000)`,
  );
  await pool.query(
    `INSERT INTO editor_workspaces (id, name, updated_at, created_at)
     VALUES ('workspace-1', 'Workspace', 1000, 1000)`,
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
     VALUES
       ('workspace-1', 'owner-1', 'owner', 1000),
       ('workspace-1', 'author-1', 'editor', 2000),
       ('workspace-1', 'editor-1', 'editor', 3000)`,
  );
  await pool.query(
    `INSERT INTO editor_documents
       (workspace_id, id, public_id, created_by, access_mode, title, position, updated_at)
     VALUES ('workspace-1', 'document-1', 'public-document-1', 'author-1', 'private', 'Private document', 0, 1000)`,
  );
  await pool.query(
    `INSERT INTO editor_blocks
       (workspace_id, id, document_id, type, heading_level, content, data, checked, assignee, due_date,
        status, parent_id, position, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, $10, NULL, $11, $12, $12)`,
    ["workspace-1", "block-1", "document-1", "paragraph", 1, "Private content", false, "", "", "unset", 0, 1000],
  );
}
