// @vitest-environment node

import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgMemPool } from "../test/pgMemDatabase";
import { migrateDatabase } from "./database/migrations";
import {
  DocumentAuthorizationService,
  DocumentNotFoundError,
  PostgresDocumentAuthorizationRecords,
} from "./documentAuthorization";
import { DocumentShareTokenService } from "./documentShareTokens";
import type { ObjectStorage, StoredObject } from "./objectStorage";
import { PostgresAttachmentStore } from "./postgresAttachmentStore";
import {
  DocumentShareGoneError,
  DocumentShareNotFoundError,
  PostgresDocumentShareStore,
} from "./postgresDocumentShareStore";

const TEST_SECRET = "test-document-share-store-secret-at-least-32-bytes";

class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, StoredObject>();

  async deletePrefix() {}

  async getObject(key: string) {
    const value = this.objects.get(key);
    if (!value) throw new Error("missing");
    return value;
  }

  async putObject(key: string, body: Uint8Array, contentType: string) {
    this.objects.set(key, { body, contentType, size: body.byteLength });
  }
}

describe("PostgresDocumentShareStore", () => {
  let now: number;
  let pool: Pool;
  let store: PostgresDocumentShareStore;
  let tokenService: DocumentShareTokenService;
  let objectStorage: MemoryObjectStorage;

  beforeEach(async () => {
    now = 10_000;
    pool = createPgMemPool();
    await migrateDatabase(pool);
    await seedDocument(pool);
    objectStorage = new MemoryObjectStorage();
    await objectStorage.putObject(
      "workspace-1/design.png",
      new TextEncoder().encode("image-body"),
      "image/png",
    );
    const attachmentStore = new PostgresAttachmentStore(pool);
    await attachmentStore.createAttachment({
      documentId: "document-1",
      key: "workspace-1/design.png",
      workspaceId: "workspace-1",
    });
    tokenService = new DocumentShareTokenService(TEST_SECRET, () => now);
    const rawTokens = ["raw-token-1", "raw-token-2", "raw-token-3"];
    vi.spyOn(tokenService, "createRawToken").mockImplementation(() => rawTokens.shift()!);
    let shareSequence = 0;
    let auditSequence = 0;
    store = new PostgresDocumentShareStore(pool, {
      appUrl: "http://localhost:3000",
      attachmentStore,
      auditEventIdFactory: () => `share-audit-${++auditSequence}`,
      authorization: new DocumentAuthorizationService(
        new PostgresDocumentAuthorizationRecords(pool),
      ),
      idFactory: () => `share-${++shareSequence}`,
      now: () => now,
      objectStorage,
      tokenService,
    });
  });

  afterEach(async () => {
    await pool.end();
    vi.restoreAllMocks();
  });

  it("creates one owner-managed link without disclosing it on reload", async () => {
    const created = await store.replaceManagedLink(
      "owner-1",
      "public-document-1",
      now + 60 * 60_000,
    );

    expect(created).toEqual({
      expiresAt: now + 60 * 60_000,
      id: "share-1",
      status: "active",
      url: "http://localhost:3000/share/raw-token-1",
    });
    await expect(store.getManagedLink("owner-1", "public-document-1"))
      .resolves.toEqual({
        expiresAt: now + 60 * 60_000,
        id: "share-1",
        status: "active",
      });
    await expect(store.getManagedLink("editor-1", "public-document-1"))
      .rejects.toBeInstanceOf(DocumentNotFoundError);
    await expect(pool.query(
      "SELECT access_mode, token_hash FROM editor_documents JOIN document_share_links ON document_share_links.document_id = editor_documents.id WHERE document_share_links.id = 'share-1'",
    )).resolves.toMatchObject({
      rows: [{
        access_mode: "link",
        token_hash: tokenService.hashRawToken("raw-token-1"),
      }],
    });

    const audits = await pool.query(
      "SELECT event_type, metadata::text AS metadata FROM workspace_audit_events ORDER BY created_at",
    );
    expect(audits.rows).toMatchObject([{ event_type: "document_share.created" }]);
    expect(JSON.stringify(audits.rows)).not.toContain("raw-token-1");
    expect(JSON.stringify(audits.rows)).not.toContain("/share/");
  });

  it("regenerates and revokes links while preserving known gone tokens", async () => {
    await store.replaceManagedLink("owner-1", "public-document-1", now + 60 * 60_000);
    const replacement = await store.replaceManagedLink(
      "owner-1",
      "public-document-1",
      now + 2 * 60 * 60_000,
    );

    expect(replacement).toMatchObject({ id: "share-2", url: expect.stringContaining("raw-token-2") });
    await expect(store.loadSharedDocument("raw-token-1"))
      .rejects.toBeInstanceOf(DocumentShareGoneError);
    await expect(store.loadSharedDocument("raw-token-2"))
      .resolves.toMatchObject({ document: { title: "Private document" } });

    await store.revokeManagedLink("owner-1", "public-document-1");
    await store.revokeManagedLink("owner-1", "public-document-1");
    await expect(store.loadSharedDocument("raw-token-2"))
      .rejects.toBeInstanceOf(DocumentShareGoneError);
  });

  it("returns a sanitized document with signed attachment URLs", async () => {
    await store.replaceManagedLink("owner-1", "public-document-1", now + 60 * 60_000);

    const snapshot = await store.loadSharedDocument("raw-token-1");
    const serialized = JSON.stringify(snapshot);
    const attachment = snapshot.document.blocks[1].data as { url: string };

    expect(serialized).toContain("Private content");
    expect(serialized).not.toContain("Internal comment");
    expect(serialized).not.toContain("workspace-1/design.png");
    expect(attachment.url).toMatch(/^\/api\/shared-files\/share-1\//);

    const url = new URL(attachment.url, "http://localhost:3000");
    const [, , , shareId, keyToken] = url.pathname.split("/");
    const object = await store.loadSharedAttachment({
      expiresAt: Number(url.searchParams.get("expiresAt")),
      keyToken,
      shareId,
      signature: url.searchParams.get("signature")!,
    });
    expect(new TextDecoder().decode(object.body)).toBe("image-body");

    await store.revokeManagedLink("owner-1", "public-document-1");
    await expect(store.loadSharedAttachment({
      expiresAt: Number(url.searchParams.get("expiresAt")),
      keyToken,
      shareId,
      signature: url.searchParams.get("signature")!,
    })).rejects.toBeInstanceOf(DocumentShareGoneError);
  });

  it("distinguishes unknown and expired tokens", async () => {
    await expect(store.loadSharedDocument("unknown-token"))
      .rejects.toBeInstanceOf(DocumentShareNotFoundError);
    await store.replaceManagedLink("owner-1", "public-document-1", now + 1);
    now += 1;
    await expect(store.loadSharedDocument("raw-token-1"))
      .rejects.toBeInstanceOf(DocumentShareGoneError);
  });
});

async function seedDocument(pool: Pool) {
  await pool.query(
    `INSERT INTO app_users (id, email, display_name, created_at)
     VALUES
       ('owner-1', 'owner@example.com', 'Owner', 1000),
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
       ('workspace-1', 'editor-1', 'editor', 1000)`,
  );
  await pool.query(
    `INSERT INTO editor_documents
       (workspace_id, id, public_id, created_by, access_mode, title, position, updated_at)
     VALUES
       ('workspace-1', 'document-1', 'public-document-1', 'owner-1',
        'private', 'Private document', 0, 1000)`,
  );
  await pool.query(
    `INSERT INTO editor_blocks
       (workspace_id, id, document_id, type, heading_level, content, data, checked,
        assignee, due_date, status, parent_id, position, created_at, updated_at)
     VALUES
       ('workspace-1', 'block-1', 'document-1', 'paragraph', 1, 'Private content',
        NULL, false, 'Internal owner', '2026-12-31', 'in-progress', NULL, 0, 1000, 1000),
       ('workspace-1', 'block-2', 'document-1', 'image', 1, 'Design',
        '{"kind":"image","key":"workspace-1/design.png","mimeType":"image/png","name":"design.png","size":10,"url":"/api/files/workspace-1/design.png"}'::jsonb,
        false, '', '', 'unset', NULL, 1, 1000, 1000)`,
  );
  await pool.query(
    `INSERT INTO block_comments
       (workspace_id, id, block_id, author, body, time_label, created_at, resolved, resolved_at)
     VALUES
       ('workspace-1', 'comment-1', 'block-1', 'Owner', 'Internal comment', '刚刚', 1000, false, NULL)`,
  );
}
