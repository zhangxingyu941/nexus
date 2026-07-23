import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NexusBlockClipboardPayload } from "../features/editor/model/blockClipboard";
import { createPgMemPool } from "../test/pgMemDatabase";
import { migrateDatabase } from "./database/migrations";
import { DocumentAuthorizationService, PostgresDocumentAuthorizationRecords } from "./documentAuthorization";
import type { ObjectStorage, StoredObject } from "./objectStorage";
import { PostgresAttachmentStore } from "./postgresAttachmentStore";
import {
  BlockClipboardPasteAttachmentError,
  BlockClipboardPasteCleanupError,
  BlockClipboardPasteService,
  BlockClipboardPasteValidationError,
} from "./blockClipboardPasteService";

class MemoryObjectStorage implements ObjectStorage {
  readonly deletedKeys: string[] = [];
  readonly objects = new Map<string, StoredObject>();
  failAfterPutForKey: string | null = null;
  failDeleteForKey: string | null = null;
  failPutForKey: string | null = null;

  async deleteObject(key: string) {
    this.deletedKeys.push(key);
    if (key === this.failDeleteForKey) throw new Error("storage cleanup unavailable");
    this.objects.delete(key);
  }

  async deletePrefix(prefix: string) {
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) this.objects.delete(key);
    }
  }

  async getObject(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error("not found");
    return object;
  }

  async putObject(key: string, body: Uint8Array, contentType: string) {
    if (key === this.failPutForKey) throw new Error("storage unavailable");
    this.objects.set(key, { body, contentType, size: body.byteLength });
    if (key === this.failAfterPutForKey) throw new Error("storage unavailable after write");
  }
}

class PausingObjectStorage extends MemoryObjectStorage {
  readonly firstDestinationWrite = createDeferred<void>();
  readonly resumeFirstDestinationWrite = createDeferred<void>();
  private destinationWriteCount = 0;

  constructor(private readonly firstDestinationKey: string) {
    super();
  }

  override async putObject(key: string, body: Uint8Array, contentType: string) {
    if (key === this.firstDestinationKey && this.destinationWriteCount++ === 0) {
      this.firstDestinationWrite.resolve();
      await this.resumeFirstDestinationWrite.promise;
    }
    await super.putObject(key, body, contentType);
  }
}

class CleanupGateObjectStorage extends MemoryObjectStorage {
  readonly cleanupStarted = createDeferred<void>();
  readonly resumeCleanup = createDeferred<void>();
  private destinationWriteCount = 0;

  constructor(private readonly destinationKey: string) {
    super();
  }

  override async putObject(key: string, body: Uint8Array, contentType: string) {
    await super.putObject(key, body, contentType);
    if (key === this.destinationKey && this.destinationWriteCount++ === 0) {
      throw new Error("first copy failed after write");
    }
  }

  override async deleteObject(key: string) {
    if (key === this.destinationKey) {
      this.cleanupStarted.resolve();
      await this.resumeCleanup.promise;
    }
    await super.deleteObject(key);
  }
}

class ReservationCoordinator {
  private readonly reservedKeys = new Set<string>();

  hasReservation(key: string) {
    return this.reservedKeys.has(key);
  }

  createPool(sourcePool: Pick<Pool, "query">): Pick<Pool, "connect" | "query"> {
    return {
      connect: async () => this.createClient(),
      query: sourcePool.query.bind(sourcePool),
    } as Pick<Pool, "connect" | "query">;
  }

  private createClient() {
    const ownedKeys = new Set<string>();
    return {
      query: async (statement: string, values?: unknown[]) => {
        if (statement === "BEGIN" || statement === "COMMIT") return { rows: [] };
        if (statement === "ROLLBACK") {
          for (const key of ownedKeys) this.reservedKeys.delete(key);
          return { rows: [] };
        }
        if (statement.includes("INSERT INTO document_attachments")) {
          const key = String(values?.[0]);
          if (this.reservedKeys.has(key)) {
            if (statement.includes("ON CONFLICT")) return { rows: [] };
            throw new Error("duplicate attachment key");
          }
          this.reservedKeys.add(key);
          ownedKeys.add(key);
          return { rows: statement.includes("RETURNING") ? [{ object_key: key }] : [] };
        }
        if (statement.includes("UPDATE document_attachments")) return { rows: [] };
        if (statement.includes("DELETE FROM document_attachments")) {
          const key = String(values?.[0]);
          this.reservedKeys.delete(key);
          ownedKeys.delete(key);
          return { rows: [] };
        }
        throw new Error(`unexpected query: ${statement}`);
      },
      release: () => undefined,
    };
  }
}

describe("BlockClipboardPasteService", () => {
  let attachmentStore: PostgresAttachmentStore;
  let authorization: DocumentAuthorizationService;
  let objectStorage: MemoryObjectStorage;
  let pool: Pool;

  beforeEach(async () => {
    pool = createPgMemPool();
    await migrateDatabase(pool);
    authorization = new DocumentAuthorizationService(new PostgresDocumentAuthorizationRecords(pool));
    attachmentStore = new PostgresAttachmentStore(pool);
    objectStorage = new MemoryObjectStorage();
    await seedDocuments(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("copies a verified source attachment and creates target ownership for the returned block", async () => {
    await seedSourceAttachment(pool, attachmentStore, objectStorage, "image-1", {
      key: "workspace-1/source-image.png",
      kind: "image",
      mimeType: "image/png",
      name: "diagram.png",
      size: 11,
    });
    const service = createService();

    const blocks = await service.paste({
      payload: createAttachmentPayload("image-1", "image", "diagram.png", "image/png", 11),
      targetDocumentId: "target-document",
      userId: "owner-1",
      workspaceId: "workspace-1",
    });

    expect(blocks).toEqual([expect.objectContaining({
      data: {
        key: "workspace-1/copied-object.png",
        kind: "image",
        mimeType: "image/png",
        name: "diagram.png",
        size: 11,
        url: "/api/files/workspace-1/copied-object.png",
      },
      id: "copied-block",
      type: "image",
    })]);
    await expect(attachmentStore.findDocumentAttachment(
      "workspace-1/copied-object.png",
      "workspace-1",
      "target-document",
    )).resolves.toEqual({
      documentId: "target-document",
      key: "workspace-1/copied-object.png",
      workspaceId: "workspace-1",
    });
    expect(objectStorage.objects.get("workspace-1/copied-object.png")).toMatchObject({
      contentType: "image/png",
      size: 11,
    });
    expect(objectStorage.deletedKeys).toEqual([]);
  });

  it("rejects an attachment snapshot that does not match the authorized source block", async () => {
    await seedSourceAttachment(pool, attachmentStore, objectStorage, "image-1", {
      key: "workspace-1/source-image.png",
      kind: "image",
      mimeType: "image/png",
      name: "diagram.png",
      size: 11,
    });
    const service = createService();

    await expect(service.paste({
      payload: createAttachmentPayload("image-1", "image", "other.png", "image/png", 11),
      targetDocumentId: "target-document",
      userId: "owner-1",
      workspaceId: "workspace-1",
    })).rejects.toBeInstanceOf(BlockClipboardPasteValidationError);

    expect(objectStorage.objects.has("workspace-1/copied-object.png")).toBe(false);
  });

  it("rejects a persisted attachment block and snapshot that both disagree with attachment kind", async () => {
    await seedSourceAttachment(pool, attachmentStore, objectStorage, "image-1", {
      key: "workspace-1/source-image.png",
      kind: "image",
      mimeType: "image/png",
      name: "diagram.png",
      size: 11,
    });
    await pool.query(
      `UPDATE editor_blocks
       SET type = 'paragraph'
       WHERE workspace_id = 'workspace-1' AND id = 'image-1'`,
    );
    const payload = createAttachmentPayload("image-1", "image", "diagram.png", "image/png", 11);
    payload.blocks[0].type = "paragraph";
    const service = createService();

    await expect(service.paste({
      payload,
      targetDocumentId: "target-document",
      userId: "owner-1",
      workspaceId: "workspace-1",
    })).rejects.toBeInstanceOf(BlockClipboardPasteValidationError);

    expect(objectStorage.objects.has("workspace-1/copied-object.png")).toBe(false);
  });

  it("retries a destination key that belongs to an unselected attachment without overwriting it", async () => {
    await seedSourceAttachment(pool, attachmentStore, objectStorage, "image-1", {
      key: "workspace-1/source-image.png",
      kind: "image",
      mimeType: "image/png",
      name: "diagram.png",
      size: 11,
    });
    const existingKey = "workspace-1/existing.png";
    const existingBody = new Uint8Array([7, 7, 7]);
    await attachmentStore.createAttachment({
      documentId: "target-document",
      key: existingKey,
      workspaceId: "workspace-1",
    });
    await objectStorage.putObject(existingKey, existingBody, "image/png");
    const objectIds = ["existing", "copied-object"];
    const service = new BlockClipboardPasteService(pool, {
      attachmentStore,
      authorization,
      blockIdFactory: () => "copied-block",
      now: () => 2000,
      objectKeyIdFactory: () => objectIds.shift()!,
      objectStorage,
    });

    const blocks = await service.paste({
      payload: createAttachmentPayload("image-1", "image", "diagram.png", "image/png", 11),
      targetDocumentId: "target-document",
      userId: "owner-1",
      workspaceId: "workspace-1",
    });

    expect(blocks[0].data).toMatchObject({ key: "workspace-1/copied-object.png" });
    expect(Array.from(objectStorage.objects.get(existingKey)!.body)).toEqual(Array.from(existingBody));
    expect(objectStorage.deletedKeys).not.toContain(existingKey);
  });

  it("keeps concurrent requests with a shared key factory from overwriting or deleting either output", async () => {
    const storage = new PausingObjectStorage("workspace-1/shared.png");
    await seedSourceAttachment(pool, attachmentStore, storage, "image-1", {
      key: "workspace-1/source-image.png",
      kind: "image",
      mimeType: "image/png",
      name: "diagram.png",
      size: 11,
    });
    const coordinator = new ReservationCoordinator();
    const servicePool = coordinator.createPool(pool);
    const firstService = new BlockClipboardPasteService(servicePool, {
      attachmentStore,
      authorization,
      blockIdFactory: () => "first-block",
      now: () => 2000,
      objectKeyIdFactory: () => "shared",
      objectStorage: storage,
    });
    const secondIds = ["shared", "second"];
    const secondService = new BlockClipboardPasteService(servicePool, {
      attachmentStore,
      authorization,
      blockIdFactory: () => "second-block",
      now: () => 2000,
      objectKeyIdFactory: () => secondIds.shift()!,
      objectStorage: storage,
    });
    const input = {
      payload: createAttachmentPayload("image-1", "image", "diagram.png", "image/png", 11),
      targetDocumentId: "target-document",
      userId: "owner-1",
      workspaceId: "workspace-1",
    };

    const firstPaste = firstService.paste(input);
    await storage.firstDestinationWrite.promise;
    const secondBlocks = await secondService.paste(input);
    storage.resumeFirstDestinationWrite.resolve();
    const firstBlocks = await firstPaste;

    expect(firstBlocks[0].data).toMatchObject({ key: "workspace-1/shared.png" });
    expect(secondBlocks[0].data).toMatchObject({ key: "workspace-1/second.png" });
    expect(storage.objects.has("workspace-1/shared.png")).toBe(true);
    expect(storage.objects.has("workspace-1/second.png")).toBe(true);
    expect(storage.deletedKeys).toEqual([]);
  });

  it("holds a failed request reservation through cleanup so a second request cannot lose a reacquired key", async () => {
    const storage = new CleanupGateObjectStorage("workspace-1/shared.png");
    await seedSourceAttachment(pool, attachmentStore, storage, "image-1", {
      key: "workspace-1/source-image.png",
      kind: "image",
      mimeType: "image/png",
      name: "diagram.png",
      size: 11,
    });
    const coordinator = new ReservationCoordinator();
    const servicePool = coordinator.createPool(pool);
    const firstService = new BlockClipboardPasteService(servicePool, {
      attachmentStore,
      authorization,
      blockIdFactory: () => "first-block",
      now: () => 2000,
      objectKeyIdFactory: () => "shared",
      objectStorage: storage,
    });
    const secondIds = ["shared", "second"];
    const secondService = new BlockClipboardPasteService(servicePool, {
      attachmentStore,
      authorization,
      blockIdFactory: () => "second-block",
      now: () => 2000,
      objectKeyIdFactory: () => secondIds.shift()!,
      objectStorage: storage,
    });
    const input = {
      payload: createAttachmentPayload("image-1", "image", "diagram.png", "image/png", 11),
      targetDocumentId: "target-document",
      userId: "owner-1",
      workspaceId: "workspace-1",
    };

    const firstPaste = firstService.paste(input).then(
      () => null,
      (reason: unknown) => reason,
    );
    await storage.cleanupStarted.promise;
    const secondBlocks = await secondService.paste(input);
    storage.resumeCleanup.resolve();
    const firstError = await firstPaste;

    expect(firstError).toBeInstanceOf(BlockClipboardPasteAttachmentError);
    expect(secondBlocks[0].data).toMatchObject({ key: "workspace-1/second.png" });
    expect(storage.objects.has("workspace-1/second.png")).toBe(true);
    expect(storage.deletedKeys).toContain("workspace-1/shared.png");
    expect(storage.deletedKeys).not.toContain("workspace-1/second.png");
  });

  it("rolls back attachment records and deletes every copied object when a copy fails", async () => {
    await seedSourceAttachment(pool, attachmentStore, objectStorage, "image-1", {
      key: "workspace-1/source-image.png",
      kind: "image",
      mimeType: "image/png",
      name: "diagram.png",
      size: 11,
    });
    await seedSourceAttachment(pool, attachmentStore, objectStorage, "file-1", {
      key: "workspace-1/source-file.pdf",
      kind: "file",
      mimeType: "application/pdf",
      name: "notes.pdf",
      size: 12,
    });
    let objectSequence = 0;
    let blockSequence = 0;
    const coordinator = new ReservationCoordinator();
    const service = new BlockClipboardPasteService(coordinator.createPool(pool), {
      attachmentStore,
      authorization,
      blockIdFactory: () => `copied-block-${++blockSequence}`,
      now: () => 2000,
      objectKeyIdFactory: () => `copied-${++objectSequence}`,
      objectStorage,
    });
    objectStorage.failAfterPutForKey = "workspace-1/copied-2.pdf";
    const payload = createAttachmentPayload("image-1", "image", "diagram.png", "image/png", 11);
    payload.blocks.push(createAttachmentSnapshot("file-1", "file", "notes.pdf", "application/pdf", 12));

    await expect(service.paste({
      payload,
      targetDocumentId: "target-document",
      userId: "owner-1",
      workspaceId: "workspace-1",
    })).rejects.toBeInstanceOf(BlockClipboardPasteAttachmentError);

    expect(objectStorage.deletedKeys).toEqual([
      "workspace-1/copied-1.png",
      "workspace-1/copied-2.pdf",
    ]);
    expect(objectStorage.objects.has("workspace-1/copied-1.png")).toBe(false);
    expect(objectStorage.objects.has("workspace-1/copied-2.pdf")).toBe(false);
    await expect(attachmentStore.findDocumentAttachment(
      "workspace-1/copied-1.png",
      "workspace-1",
      "target-document",
    )).resolves.toBeNull();
    expect(coordinator.hasReservation("workspace-1/copied-1.png")).toBe(false);
    expect(objectStorage.deletedKeys).not.toContain("workspace-1/source-image.png");
    expect(objectStorage.deletedKeys).not.toContain("workspace-1/source-file.pdf");
  });

  it("surfaces a cleanup failure with the original attachment-copy error", async () => {
    await seedSourceAttachment(pool, attachmentStore, objectStorage, "image-1", {
      key: "workspace-1/source-image.png",
      kind: "image",
      mimeType: "image/png",
      name: "diagram.png",
      size: 11,
    });
    const service = createService();
    objectStorage.failAfterPutForKey = "workspace-1/copied-object.png";
    objectStorage.failDeleteForKey = "workspace-1/copied-object.png";

    const error = await service.paste({
      payload: createAttachmentPayload("image-1", "image", "diagram.png", "image/png", 11),
      targetDocumentId: "target-document",
      userId: "owner-1",
      workspaceId: "workspace-1",
    }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(BlockClipboardPasteCleanupError);
    const operationError = (error as BlockClipboardPasteCleanupError).operationError;
    expect(operationError).toBeInstanceOf(BlockClipboardPasteAttachmentError);
    expect((operationError as BlockClipboardPasteAttachmentError).originalError)
      .toMatchObject({ message: "storage unavailable after write" });
    expect((error as BlockClipboardPasteCleanupError).cleanupErrors).toHaveLength(1);
    expect(objectStorage.objects.has("workspace-1/copied-object.png")).toBe(true);
    await expect(pool.query(
      `SELECT cleanup_pending FROM document_attachments
       WHERE object_key = 'workspace-1/copied-object.png'`,
    )).resolves.toMatchObject({ rows: [{ cleanup_pending: true }] });
  });

  it("does not copy objects when block materialization cannot generate unique ids", async () => {
    await seedSourceAttachment(pool, attachmentStore, objectStorage, "image-1", {
      key: "workspace-1/source-image.png",
      kind: "image",
      mimeType: "image/png",
      name: "diagram.png",
      size: 11,
    });
    await seedSourceAttachment(pool, attachmentStore, objectStorage, "file-1", {
      key: "workspace-1/source-file.pdf",
      kind: "file",
      mimeType: "application/pdf",
      name: "notes.pdf",
      size: 12,
    });
    const service = new BlockClipboardPasteService(pool, {
      attachmentStore,
      authorization,
      blockIdFactory: () => "duplicate-block",
      now: () => 2000,
      objectKeyIdFactory: (() => {
        let sequence = 0;
        return () => `copied-${++sequence}`;
      })(),
      objectStorage,
    });
    const payload = createAttachmentPayload("image-1", "image", "diagram.png", "image/png", 11);
    payload.blocks.push(createAttachmentSnapshot("file-1", "file", "notes.pdf", "application/pdf", 12));

    await expect(service.paste({
      payload,
      targetDocumentId: "target-document",
      userId: "owner-1",
      workspaceId: "workspace-1",
    })).rejects.toThrow("复制块 ID 无效");

    expect(objectStorage.objects.has("workspace-1/copied-1.png")).toBe(false);
    expect(objectStorage.objects.has("workspace-1/copied-2.pdf")).toBe(false);
    await expect(pool.query(
      `SELECT object_key FROM document_attachments
       WHERE workspace_id = 'workspace-1' AND document_id = 'target-document'`,
    )).resolves.toMatchObject({ rows: [] });
  });

  it("never deletes a source object when a generated destination key collides with it", async () => {
    await seedSourceAttachment(pool, attachmentStore, objectStorage, "image-1", {
      key: "workspace-1/source-image.png",
      kind: "image",
      mimeType: "image/png",
      name: "diagram.png",
      size: 11,
    });
    const service = new BlockClipboardPasteService(pool, {
      attachmentStore,
      authorization,
      blockIdFactory: () => "copied-block",
      now: () => 2000,
      objectKeyIdFactory: () => "source-image",
      objectStorage,
    });

    await expect(service.paste({
      payload: createAttachmentPayload("image-1", "image", "diagram.png", "image/png", 11),
      targetDocumentId: "target-document",
      userId: "owner-1",
      workspaceId: "workspace-1",
    })).rejects.toBeInstanceOf(BlockClipboardPasteAttachmentError);

    expect(objectStorage.objects.has("workspace-1/source-image.png")).toBe(true);
    expect(objectStorage.deletedKeys).toEqual([]);
  });

  function createService() {
    return new BlockClipboardPasteService(pool, {
      attachmentStore,
      authorization,
      blockIdFactory: () => "copied-block",
      now: () => 2000,
      objectKeyIdFactory: () => "copied-object",
      objectStorage,
    });
  }
});

function createAttachmentPayload(
  sourceId: string,
  kind: "image" | "file",
  name: string,
  mimeType: string,
  size: number,
): NexusBlockClipboardPayload {
  return {
    blocks: [createAttachmentSnapshot(sourceId, kind, name, mimeType, size)],
    copiedAt: 1000,
    sourceDocumentId: "source-document",
    sourceWorkspaceId: "workspace-1",
    version: 1,
  };
}

function createAttachmentSnapshot(
  sourceId: string,
  kind: "image" | "file",
  name: string,
  mimeType: string,
  size: number,
): NexusBlockClipboardPayload["blocks"][number] {
  return {
    assignee: "",
    checked: false,
    content: name,
    data: { kind, mimeType, name, size },
    dueDate: "",
    headingLevel: 1,
    richText: null,
    sourceChildren: [],
    sourceId,
    sourceParentId: null,
    status: "unset",
    type: kind,
  };
}

async function seedDocuments(pool: Pool) {
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
     VALUES
       ('workspace-1', 'source-document', 'public-source', 'owner-1', 'private', 'Source', 0, 1000),
       ('workspace-1', 'target-document', 'public-target', 'owner-1', 'private', 'Target', 1, 1000)`,
  );
}

async function seedSourceAttachment(
  pool: Pool,
  attachmentStore: PostgresAttachmentStore,
  objectStorage: MemoryObjectStorage,
  blockId: string,
  attachment: {
    key: string;
    kind: "image" | "file";
    mimeType: string;
    name: string;
    size: number;
  },
) {
  await pool.query(
    `INSERT INTO editor_blocks
       (workspace_id, id, document_id, type, heading_level, content, rich_text, data, checked,
        assignee, due_date, status, parent_id, position, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 1, $5, NULL, $6::jsonb, false, '', '', 'unset', NULL, 0, 1000, 1000)`,
    [
      "workspace-1",
      blockId,
      "source-document",
      attachment.kind,
      attachment.name,
      JSON.stringify({
        ...attachment,
        url: `/api/files/${attachment.key}`,
      }),
    ],
  );
  await attachmentStore.createAttachment({
    documentId: "source-document",
    key: attachment.key,
    workspaceId: "workspace-1",
  });
  await objectStorage.putObject(
    attachment.key,
    new Uint8Array(attachment.size).fill(1),
    attachment.mimeType,
  );
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((currentResolve) => {
    resolve = currentResolve;
  });
  return { promise, resolve };
}
