import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgMemPool } from "../test/pgMemDatabase";
import { migrateDatabase } from "./database/migrations";
import { PostgresDocumentAuthorizationRecords } from "./documentAuthorization";

describe("PostgresDocumentAuthorizationRecords", () => {
  let pool: Pool;
  let records: PostgresDocumentAuthorizationRecords;

  beforeEach(async () => {
    pool = createPgMemPool();
    await migrateDatabase(pool);
    records = new PostgresDocumentAuthorizationRecords(pool);
    await seedDocumentAccessFixture(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("resolves a document by its globally unique public id", async () => {
    await expect(records.findRecord("owner-2", "public-document-1")).resolves.toEqual({
      accessMode: "private",
      documentCreatedBy: "author-1",
      documentId: "document-1",
      explicitRole: null,
      publicId: "public-document-1",
      workspaceId: "workspace-1",
      workspaceRole: "owner",
    });
    await expect(records.findRecord("owner-2", "document-1")).resolves.toBeNull();
  });

  it("returns an explicit permission alongside the member role", async () => {
    await expect(records.findRecord("viewer-1", "public-document-1")).resolves.toMatchObject({
      explicitRole: "viewer",
      workspaceRole: "editor",
    });
  });

  it("does not resolve documents in a deleted workspace", async () => {
    await pool.query(
      `UPDATE editor_workspaces
       SET deleted_at = $1, deleted_by = $2, purge_after = $3
       WHERE id = $4`,
      [5000, "owner-1", 604_805_000, "workspace-1"],
    );

    await expect(records.findRecord("owner-1", "public-document-1")).resolves.toBeNull();
  });
});

async function seedDocumentAccessFixture(pool: Pool) {
  await pool.query(
    `INSERT INTO app_users (id, email, display_name, created_at)
     VALUES
       ('owner-1', 'owner-1@example.com', 'Owner one', 1000),
       ('owner-2', 'owner-2@example.com', 'Owner two', 1000),
       ('author-1', 'author@example.com', 'Author', 1000),
       ('viewer-1', 'viewer@example.com', 'Viewer', 1000)`,
  );
  await pool.query(
    `INSERT INTO editor_workspaces (id, name, updated_at, created_at)
     VALUES ('workspace-1', 'Workspace', 1000, 1000)`,
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
     VALUES
       ('workspace-1', 'owner-1', 'owner', 1000),
       ('workspace-1', 'owner-2', 'owner', 2000),
       ('workspace-1', 'author-1', 'editor', 3000),
       ('workspace-1', 'viewer-1', 'editor', 4000)`,
  );
  await pool.query(
    `INSERT INTO editor_documents
       (workspace_id, id, public_id, created_by, access_mode, title, position, updated_at)
     VALUES ('workspace-1', 'document-1', 'public-document-1', 'author-1', 'private', 'Private document', 0, 1000)`,
  );
  await pool.query(
    `INSERT INTO document_permissions
       (workspace_id, document_id, user_id, role, created_by, created_at, updated_at)
     VALUES ('workspace-1', 'document-1', 'viewer-1', 'viewer', 'owner-1', 1000, 1000)`,
  );
}
