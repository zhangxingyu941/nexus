import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  materializeClipboardBlocks,
  type ClipboardAttachmentData,
  type NexusBlockClipboardPayload,
} from "../features/editor/model/blockClipboard";
import type { Block } from "../features/editor/model/block";
import type { DocumentAuthorizationService } from "./documentAuthorization";
import { createObjectKey, type ObjectStorage, type StoredObject } from "./objectStorage";
import type { PostgresAttachmentStore } from "./postgresAttachmentStore";

const INVALID_CLIPBOARD_ERROR = "块剪贴板内容无效";
const INVALID_SOURCE_ATTACHMENT_ERROR = "源附件无效";
const MAX_DESTINATION_KEY_ATTEMPTS = 8;

export class BlockClipboardPasteValidationError extends Error {
  constructor(message = INVALID_CLIPBOARD_ERROR) {
    super(message);
    this.name = "BlockClipboardPasteValidationError";
  }
}

export class BlockClipboardPasteAttachmentError extends Error {
  readonly originalError: unknown;

  constructor(originalError?: unknown) {
    super("附件复制失败");
    this.name = "BlockClipboardPasteAttachmentError";
    this.originalError = originalError;
  }
}

export class BlockClipboardPasteCleanupError extends Error {
  constructor(
    readonly operationError: BlockClipboardPasteAttachmentError | BlockClipboardPasteValidationError,
    readonly cleanupErrors: unknown[],
  ) {
    super("附件复制失败，清理未完成");
    this.name = "BlockClipboardPasteCleanupError";
  }
}

interface BlockClipboardPasteServiceOptions {
  attachmentStore: Pick<PostgresAttachmentStore, "findAttachment" | "findDocumentAttachment">;
  authorization: Pick<DocumentAuthorizationService, "requireWorkspaceDocumentAction">;
  blockIdFactory?: () => string;
  now?: () => number;
  objectKeyIdFactory?: () => string;
  objectStorage: Pick<ObjectStorage, "deleteObject" | "getObject" | "putObject">;
}

interface PasteBlocksInput {
  payload: NexusBlockClipboardPayload;
  targetDocumentId: string;
  userId: string;
  workspaceId: string;
}

interface SourceAttachment {
  snapshotIndex: number;
  source: ClipboardAttachmentData & { key: string };
}

interface CopiedAttachment extends SourceAttachment {
  object: StoredObject;
  targetKey: string;
}

export class BlockClipboardPasteService {
  private readonly attachmentStore: BlockClipboardPasteServiceOptions["attachmentStore"];
  private readonly authorization: BlockClipboardPasteServiceOptions["authorization"];
  private readonly blockIdFactory: () => string;
  private readonly now: () => number;
  private readonly objectKeyIdFactory: () => string;
  private readonly objectStorage: BlockClipboardPasteServiceOptions["objectStorage"];

  constructor(
    private readonly pool: Pick<Pool, "connect" | "query">,
    options: BlockClipboardPasteServiceOptions,
  ) {
    this.attachmentStore = options.attachmentStore;
    this.authorization = options.authorization;
    this.blockIdFactory = options.blockIdFactory ?? (() => `block-${randomUUID()}`);
    this.now = options.now ?? Date.now;
    this.objectKeyIdFactory = options.objectKeyIdFactory ?? randomUUID;
    this.objectStorage = options.objectStorage;
  }

  async paste(input: PasteBlocksInput): Promise<Block[]> {
    if (input.payload.sourceWorkspaceId !== input.workspaceId) {
      throw new BlockClipboardPasteValidationError("只能粘贴同一工作区的块");
    }

    const [sourceAccess, targetAccess] = await Promise.all([
      this.authorization.requireWorkspaceDocumentAction(
        input.userId,
        input.workspaceId,
        input.payload.sourceDocumentId,
        "read",
      ),
      this.authorization.requireWorkspaceDocumentAction(
        input.userId,
        input.workspaceId,
        input.targetDocumentId,
        "write",
      ),
    ]);
    if (
      sourceAccess.workspaceId !== input.workspaceId
      || targetAccess.workspaceId !== input.workspaceId
    ) {
      throw new BlockClipboardPasteValidationError();
    }

    const sourceAttachments = await this.resolveSourceAttachments(
      input.payload,
      input.workspaceId,
      sourceAccess.documentId,
    );
    const blocks = this.materialize(input.payload, input.workspaceId);
    const reservedKeys: string[] = [];
    const sourceObjectKeys = new Set(sourceAttachments.map((attachment) => attachment.source.key));
    const destinationObjectKeys = new Set<string>();
    let transaction: Pick<PoolClient, "query" | "release"> | null = null;

    try {
      transaction = await this.pool.connect();
      await transaction.query("BEGIN");
      const copiedAttachments: CopiedAttachment[] = [];
      for (const sourceAttachment of sourceAttachments) {
        const object = await this.objectStorage.getObject(sourceAttachment.source.key);
        const targetKey = await this.reserveDestinationKey(
          transaction,
          input.workspaceId,
          targetAccess.documentId,
          sourceAttachment.source.name,
          sourceObjectKeys,
          destinationObjectKeys,
        );
        reservedKeys.push(targetKey);
        await this.objectStorage.putObject(targetKey, object.body, object.contentType);
        copiedAttachments.push({ ...sourceAttachment, object, targetKey });
      }

      await this.markReservationsReady(transaction, reservedKeys);
      await transaction.query("COMMIT");

      return this.applyCopiedAttachments(blocks, copiedAttachments);
    } catch (error) {
      const operationError = toOperationError(error);
      const cleanupErrors: unknown[] = [];
      if (transaction) {
        const cleanupResults = await Promise.all(
          reservedKeys.map(async (key) => {
            try {
              await this.objectStorage.deleteObject(key);
              return { error: null, key };
            } catch (cleanupError) {
              return { error: cleanupError, key };
            }
          }),
        );
        const failedCleanups = cleanupResults.filter((result) => result.error !== null);

        for (const result of failedCleanups) {
          cleanupErrors.push(result.error);
        }

        if (failedCleanups.length === 0) {
          try {
            await transaction.query("ROLLBACK");
          } catch (rollbackError) {
            cleanupErrors.push(rollbackError);
          }
        } else {
          for (const result of cleanupResults) {
            if (result.error !== null) continue;

            try {
              await this.releaseCleanedReservation(transaction, result.key);
            } catch (releaseError) {
              cleanupErrors.push(releaseError);
            }
          }
          try {
            await transaction.query("COMMIT");
          } catch (commitError) {
            cleanupErrors.push(commitError);
          }
        }
      }
      if (cleanupErrors.length > 0) {
        throw new BlockClipboardPasteCleanupError(operationError, cleanupErrors);
      }
      throw operationError;
    } finally {
      transaction?.release();
    }
  }

  private async resolveSourceAttachments(
    payload: NexusBlockClipboardPayload,
    workspaceId: string,
    sourceDocumentId: string,
  ): Promise<SourceAttachment[]> {
    const sourceAttachments: SourceAttachment[] = [];

    for (const [snapshotIndex, snapshot] of payload.blocks.entries()) {
      if (!isClipboardAttachment(snapshot.data)) continue;
      const result = await this.pool.query(
        `SELECT type, data
         FROM editor_blocks
         WHERE workspace_id = $1 AND document_id = $2 AND id = $3`,
        [workspaceId, sourceDocumentId, snapshot.sourceId],
      );
      const storedAttachment = readStoredAttachment(result.rows[0]?.data);
      if (
        !result.rows[0]
        || !matchesAttachmentType(snapshot.type, snapshot.data)
        || result.rows[0].type !== snapshot.type
        || !storedAttachment
        || result.rows[0].type !== storedAttachment.kind
        || !matchesSnapshot(storedAttachment, snapshot.data)
      ) {
        throw new BlockClipboardPasteValidationError(INVALID_SOURCE_ATTACHMENT_ERROR);
      }
      const attachment = await this.attachmentStore.findDocumentAttachment(
        storedAttachment.key,
        workspaceId,
        sourceDocumentId,
      );
      if (
        !attachment
        || attachment.key !== storedAttachment.key
        || attachment.workspaceId !== workspaceId
        || attachment.documentId !== sourceDocumentId
      ) {
        throw new BlockClipboardPasteValidationError(INVALID_SOURCE_ATTACHMENT_ERROR);
      }

      sourceAttachments.push({
        snapshotIndex,
        source: storedAttachment,
      });
    }

    return sourceAttachments;
  }

  private async reserveDestinationKey(
    transaction: Pick<PoolClient, "query">,
    workspaceId: string,
    targetDocumentId: string,
    filename: string,
    sourceObjectKeys: Set<string>,
    destinationObjectKeys: Set<string>,
  ) {
    for (let attempt = 0; attempt < MAX_DESTINATION_KEY_ATTEMPTS; attempt += 1) {
      const key = createObjectKey(workspaceId, filename, this.objectKeyIdFactory);
      if (sourceObjectKeys.has(key) || destinationObjectKeys.has(key)) {
        continue;
      }
      if (await this.attachmentStore.findAttachment(key)) {
        continue;
      }
      const reservation = await transaction.query(
        `INSERT INTO document_attachments
           (object_key, workspace_id, document_id, created_at, cleanup_pending)
         VALUES ($1, $2, $3, $4, TRUE)
         ON CONFLICT (object_key) DO NOTHING
         RETURNING object_key`,
        [key, workspaceId, targetDocumentId, this.now()],
      );
      if (!reservation.rows[0]) {
        continue;
      }

      destinationObjectKeys.add(key);
      return key;
    }

    throw new BlockClipboardPasteAttachmentError();
  }

  private async markReservationsReady(
    transaction: Pick<PoolClient, "query">,
    reservedKeys: string[],
  ) {
    for (const key of reservedKeys) {
      await transaction.query(
        `UPDATE document_attachments
         SET cleanup_pending = FALSE
         WHERE object_key = $1`,
        [key],
      );
    }
  }

  private async releaseCleanedReservation(
    transaction: Pick<PoolClient, "query">,
    key: string,
  ) {
    await transaction.query(
      "DELETE FROM document_attachments WHERE object_key = $1",
      [key],
    );
  }

  private materialize(
    payload: NexusBlockClipboardPayload,
    workspaceId: string,
  ): Block[] {
    const now = this.now();
    return materializeClipboardBlocks(payload, {
      nextId: this.blockIdFactory,
      now,
      targetWorkspaceId: workspaceId,
    });
  }

  private applyCopiedAttachments(
    blocks: Block[],
    copiedAttachments: CopiedAttachment[],
  ): Block[] {
    const copiedBySnapshot = new Map(copiedAttachments.map((attachment) => [
      attachment.snapshotIndex,
      attachment,
    ]));

    return blocks.map((block, snapshotIndex) => {
      const copiedAttachment = copiedBySnapshot.get(snapshotIndex);
      if (!copiedAttachment) return block;

      return {
        ...block,
        data: {
          key: copiedAttachment.targetKey,
          kind: copiedAttachment.source.kind,
          mimeType: copiedAttachment.source.mimeType,
          name: copiedAttachment.source.name,
          size: copiedAttachment.source.size,
          url: toFileUrl(copiedAttachment.targetKey),
        },
      };
    });
  }
}

function isClipboardAttachment(value: NexusBlockClipboardPayload["blocks"][number]["data"]): value is ClipboardAttachmentData {
  if (!value) return false;
  return (value.kind === "image" || value.kind === "file") && !("key" in value);
}

function readStoredAttachment(value: unknown): (ClipboardAttachmentData & { key: string }) | null {
  const data = typeof value === "string" ? parseJson(value) : value;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const attachment = data as Record<string, unknown>;
  return (
    (attachment.kind === "image" || attachment.kind === "file")
    && typeof attachment.key === "string"
    && Boolean(attachment.key)
    && typeof attachment.mimeType === "string"
    && typeof attachment.name === "string"
    && Boolean(attachment.name)
    && typeof attachment.size === "number"
    && Number.isFinite(attachment.size)
    && attachment.size >= 0
  )
    ? {
        key: attachment.key,
        kind: attachment.kind,
        mimeType: attachment.mimeType,
        name: attachment.name,
        size: attachment.size,
      }
    : null;
}

function matchesSnapshot(
  source: ClipboardAttachmentData & { key: string },
  snapshot: ClipboardAttachmentData,
) {
  return source.kind === snapshot.kind
    && source.mimeType === snapshot.mimeType
    && source.name === snapshot.name
    && source.size === snapshot.size;
}

function matchesAttachmentType(
  type: NexusBlockClipboardPayload["blocks"][number]["type"],
  attachment: ClipboardAttachmentData,
) {
  return type === attachment.kind;
}

function toOperationError(error: unknown) {
  if (
    error instanceof BlockClipboardPasteAttachmentError
    || error instanceof BlockClipboardPasteValidationError
  ) {
    return error;
  }
  return new BlockClipboardPasteAttachmentError(error);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toFileUrl(key: string) {
  return `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`;
}
