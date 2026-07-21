import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgMemPool } from "../test/pgMemDatabase";
import { migrateDatabase } from "./database/migrations";
import {
  DocumentAuthorizationService,
  DocumentNotFoundError,
  PostgresDocumentAuthorizationRecords,
} from "./documentAuthorization";
import { DocumentPolicyMemberError, PostgresDocumentStore } from "./postgresDocumentStore";

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

  it("creates a workspace editor document with a server public id", async () => {
    const document = {
      blocks: [{
        assignee: "",
        checked: false,
        children: [],
        comments: [],
        content: "New content",
        createdAt: 2000,
        data: null,
        dueDate: "",
        headingLevel: 1 as const,
        id: "block-new",
        parentId: null,
        status: "unset" as const,
        type: "paragraph" as const,
        updatedAt: 2000,
      }],
      id: "document-new",
      title: "New document",
      updatedAt: 2000,
    };

    const created = await store.createDocument("editor-1", "workspace-1", document, 1);

    expect(created).toMatchObject({
      access: {
        canWrite: true,
        documentId: "document-new",
        workspaceId: "workspace-1",
      },
      document: {
        id: "document-new",
        title: "New document",
      },
    });
    expect(created.access.publicId).toEqual(expect.any(String));
    await expect(store.loadDocument("editor-1", created.access.publicId)).resolves.toMatchObject({
      document: { blocks: [expect.objectContaining({ content: "New content" })] },
    });
    await expect(pool.query(
      `SELECT created_by, access_mode, position
       FROM editor_documents
       WHERE workspace_id = $1 AND id = $2`,
      ["workspace-1", "document-new"],
    )).resolves.toMatchObject({
      rows: [{ access_mode: "workspace", created_by: "editor-1", position: 1 }],
    });
  });

  it("deletes a writable document and selects an accessible replacement", async () => {
    await store.replaceDocumentPolicy("owner-1", "public-document-1", {
      accessMode: "workspace",
      permissions: [],
    });
    const created = await store.createDocument("editor-1", "workspace-1", {
      blocks: [],
      id: "document-delete",
      title: "Delete me",
      updatedAt: 2000,
    }, 1);

    const deleted = await store.deleteDocument(
      "editor-1",
      "workspace-1",
      created.access.publicId,
    );

    expect(deleted).toEqual({ activeDocumentPublicId: "public-document-1" });
    await expect(store.loadDocument("editor-1", created.access.publicId))
      .rejects.toBeInstanceOf(DocumentNotFoundError);
    await expect(pool.query(
      `SELECT id, position
       FROM editor_documents
       WHERE workspace_id = $1
       ORDER BY position ASC`,
      ["workspace-1"],
    )).resolves.toMatchObject({ rows: [{ id: "document-1", position: 0 }] });
  });

  it("saves one writable document without changing its public identity or author", async () => {
    const loaded = await store.loadDocument("owner-1", "public-document-1");
    const nextDocument = {
      ...loaded.document,
      blocks: [{
        ...loaded.document.blocks[0],
        content: "Updated private content",
        updatedAt: 2000,
      }],
      title: "Updated private document",
      updatedAt: 2000,
    };

    await store.saveDocument("owner-1", "public-document-1", nextDocument);

    await expect(store.loadDocument("owner-1", "public-document-1")).resolves.toMatchObject({
      document: {
        blocks: [expect.objectContaining({ content: "Updated private content" })],
        title: "Updated private document",
      },
    });
    await expect(pool.query(
      `SELECT public_id, created_by
       FROM editor_documents
       WHERE workspace_id = $1 AND id = $2`,
      ["workspace-1", "document-1"],
    )).resolves.toMatchObject({
      rows: [{ created_by: "author-1", public_id: "public-document-1" }],
    });
  });

  it("records document saves as versions and allows an explicit editor to restore one", async () => {
    const initial = await store.loadDocument("owner-1", "public-document-1");
    const firstVersionDocument = {
      ...initial.document,
      blocks: [{ ...initial.document.blocks[0], content: "First version", updatedAt: 2000 }],
      updatedAt: 2000,
    };
    await store.saveDocument("owner-1", "public-document-1", firstVersionDocument);
    const secondVersionDocument = {
      ...firstVersionDocument,
      blocks: [{ ...firstVersionDocument.blocks[0], content: "Second version", updatedAt: 3000 }],
      updatedAt: 3000,
    };
    await store.saveDocument("owner-1", "public-document-1", secondVersionDocument);
    await store.replaceDocumentPolicy("owner-1", "public-document-1", {
      accessMode: "private",
      permissions: [{ role: "editor", userId: "editor-1" }],
    });

    const versions = await store.listDocumentVersions("editor-1", "public-document-1");
    await store.restoreDocumentVersion("editor-1", "public-document-1", versions[1].id);

    await expect(store.loadDocument("editor-1", "public-document-1")).resolves.toMatchObject({
      document: {
        blocks: [expect.objectContaining({ content: "First version" })],
      },
    });
  });

  it("loads and replaces a managed document policy", async () => {
    await expect(store.loadDocumentPolicy("owner-1", "public-document-1")).resolves.toMatchObject({
      access: { canManage: true, publicId: "public-document-1" },
      policy: { accessMode: "private", permissions: [] },
    });

    await store.replaceDocumentPolicy("owner-1", "public-document-1", {
      accessMode: "workspace",
      permissions: [{ role: "viewer", userId: "editor-1" }],
    });

    await expect(store.loadDocumentPolicy("owner-1", "public-document-1")).resolves.toMatchObject({
      policy: {
        accessMode: "workspace",
        permissions: [{ role: "viewer", userId: "editor-1" }],
      },
    });
  });

  it("does not replace a policy when a granted user is no longer a workspace member", async () => {
    await store.replaceDocumentPolicy("owner-1", "public-document-1", {
      accessMode: "private",
      permissions: [{ role: "viewer", userId: "editor-1" }],
    });

    await expect(store.replaceDocumentPolicy("owner-1", "public-document-1", {
      accessMode: "workspace",
      permissions: [{ role: "editor", userId: "former-member-1" }],
    })).rejects.toBeInstanceOf(DocumentPolicyMemberError);

    await expect(store.loadDocumentPolicy("owner-1", "public-document-1")).resolves.toMatchObject({
      policy: {
        accessMode: "private",
        permissions: [{ role: "viewer", userId: "editor-1" }],
      },
    });
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
