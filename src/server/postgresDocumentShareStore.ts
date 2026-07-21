import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  Block,
  EditorDocument,
  HeadingLevel,
} from "../features/editor/model/block";
import {
  resolveDocumentShareExpiresAt,
  type CreatedDocumentShare,
  type DocumentShareSummary,
  type SharedDocumentSnapshot,
} from "../shared/documentShare";
import type { DocumentAuthorizationService } from "./documentAuthorization";
import type { DocumentShareTokenService } from "./documentShareTokens";
import type { ObjectStorage, StoredObject } from "./objectStorage";
import type { PostgresAttachmentStore } from "./postgresAttachmentStore";
import { createSharedDocumentSnapshot } from "./sharedDocumentSnapshot";
import { WorkspaceAuditStore } from "./workspaceAuditStore";

interface DocumentShareStoreOptions {
  appUrl?: string;
  attachmentStore: Pick<
    PostgresAttachmentStore,
    "findDocumentAttachment" | "listDocumentAttachments"
  >;
  auditEventIdFactory?: () => string;
  authorization: Pick<DocumentAuthorizationService, "requireUserAction">;
  idFactory?: () => string;
  now?: () => number;
  objectStorage: Pick<ObjectStorage, "getObject">;
  tokenService: Pick<
    DocumentShareTokenService,
    "createRawToken" | "hashRawToken" | "signAttachment" | "verifyAttachment"
  >;
}

interface DocumentShareRecord {
  documentId: string;
  expiresAt: number;
  id: string;
  revokedAt: number | null;
  workspaceDeletedAt: number | null;
  workspaceId: string;
  workspaceName: string;
}

export class DocumentShareNotFoundError extends Error {
  constructor() {
    super("分享链接不存在");
    this.name = "DocumentShareNotFoundError";
  }
}

export class DocumentShareGoneError extends Error {
  constructor() {
    super("分享链接已失效");
    this.name = "DocumentShareGoneError";
  }
}

export class PostgresDocumentShareStore {
  private readonly appUrl: string;
  private readonly attachmentStore: DocumentShareStoreOptions["attachmentStore"];
  private readonly auditStore: WorkspaceAuditStore;
  private readonly authorization: DocumentShareStoreOptions["authorization"];
  private readonly idFactory: () => string;
  private readonly now: () => number;
  private readonly objectStorage: DocumentShareStoreOptions["objectStorage"];
  private readonly tokenService: DocumentShareStoreOptions["tokenService"];

  constructor(
    private readonly pool: Pool,
    options: DocumentShareStoreOptions,
  ) {
    this.appUrl = (options.appUrl ?? process.env.APP_URL ?? "http://localhost:3000")
      .replace(/\/+$/, "");
    this.attachmentStore = options.attachmentStore;
    this.auditStore = new WorkspaceAuditStore(
      options.auditEventIdFactory ?? (() => `workspace-audit-${randomUUID()}`),
      options.now,
    );
    this.authorization = options.authorization;
    this.idFactory = options.idFactory ?? (() => `share-${randomUUID()}`);
    this.now = options.now ?? Date.now;
    this.objectStorage = options.objectStorage;
    this.tokenService = options.tokenService;
  }

  async getManagedLink(
    userId: string,
    publicId: string,
  ): Promise<DocumentShareSummary | null> {
    const access = await this.authorization.requireUserAction(userId, publicId, "manage");
    const result = await this.pool.query(
      `SELECT id, expires_at
       FROM document_share_links
       WHERE workspace_id = $1 AND document_id = $2 AND revoked_at IS NULL
       LIMIT 1`,
      [access.workspaceId, access.documentId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    const expiresAt = Number(row.expires_at);
    return {
      expiresAt,
      id: String(row.id),
      status: expiresAt <= this.now() ? "expired" : "active",
    };
  }

  async replaceManagedLink(
    userId: string,
    publicId: string,
    requestedExpiresAt?: number,
  ): Promise<CreatedDocumentShare> {
    const access = await this.authorization.requireUserAction(userId, publicId, "manage");
    const now = this.now();
    const expiresAt = resolveDocumentShareExpiresAt(requestedExpiresAt, now);
    const rawToken = this.tokenService.createRawToken();
    const tokenHash = this.tokenService.hashRawToken(rawToken);
    const shareId = this.idFactory();
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const workspace = await client.query(
        `SELECT workspaces.name
         FROM editor_documents documents
         INNER JOIN editor_workspaces workspaces ON workspaces.id = documents.workspace_id
         WHERE documents.workspace_id = $1 AND documents.id = $2
         FOR UPDATE`,
        [access.workspaceId, access.documentId],
      );
      if (!workspace.rows[0]) {
        throw new DocumentShareNotFoundError();
      }
      const revoked = await client.query(
        `UPDATE document_share_links
         SET revoked_at = $1, updated_at = $1
         WHERE workspace_id = $2 AND document_id = $3 AND revoked_at IS NULL
         RETURNING id`,
        [now, access.workspaceId, access.documentId],
      );
      await client.query(
        `INSERT INTO document_share_links
           (id, workspace_id, document_id, token_hash, created_by,
            expires_at, revoked_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $7)`,
        [
          shareId,
          access.workspaceId,
          access.documentId,
          tokenHash,
          userId,
          expiresAt,
          now,
        ],
      );
      await client.query(
        `UPDATE editor_documents
         SET access_mode = 'link', updated_at = $1
         WHERE workspace_id = $2 AND id = $3`,
        [now, access.workspaceId, access.documentId],
      );
      await this.auditStore.write(client, {
        actorUserId: userId,
        eventType: revoked.rows.length > 0
          ? "document_share.regenerated"
          : "document_share.created",
        metadata: {
          documentId: access.documentId,
          expiresAt,
          ...(revoked.rows[0] ? { replacedShareId: String(revoked.rows[0].id) } : {}),
          shareId,
        },
        targetId: shareId,
        targetType: "document_share",
        workspaceId: access.workspaceId,
        workspaceName: String(workspace.rows[0].name),
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return {
      expiresAt,
      id: shareId,
      status: "active",
      url: `${this.appUrl}/share/${encodeURIComponent(rawToken)}`,
    };
  }

  async revokeManagedLink(userId: string, publicId: string) {
    const access = await this.authorization.requireUserAction(userId, publicId, "manage");
    const now = this.now();
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const workspace = await client.query(
        "SELECT name FROM editor_workspaces WHERE id = $1",
        [access.workspaceId],
      );
      const revoked = await client.query(
        `UPDATE document_share_links
         SET revoked_at = $1, updated_at = $1
         WHERE workspace_id = $2 AND document_id = $3 AND revoked_at IS NULL
         RETURNING id, expires_at`,
        [now, access.workspaceId, access.documentId],
      );
      for (const row of revoked.rows) {
        const shareId = String(row.id);
        await this.auditStore.write(client, {
          actorUserId: userId,
          eventType: "document_share.revoked",
          metadata: {
            documentId: access.documentId,
            expiresAt: Number(row.expires_at),
            reason: "owner-revoked",
            shareId,
          },
          targetId: shareId,
          targetType: "document_share",
          workspaceId: access.workspaceId,
          workspaceName: String(workspace.rows[0]?.name ?? ""),
        });
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async loadSharedDocument(rawToken: string): Promise<SharedDocumentSnapshot> {
    const record = await this.findShareByToken(rawToken);
    if (!record) {
      throw new DocumentShareNotFoundError();
    }
    if (this.isGone(record)) {
      await this.recordAccessAudit(record, "document_share.access_denied", "share-gone");
      throw new DocumentShareGoneError();
    }

    const [document, attachments] = await Promise.all([
      this.loadDocument(record.workspaceId, record.documentId),
      this.attachmentStore.listDocumentAttachments(record.workspaceId, record.documentId),
    ]);
    const signedAttachmentUrls = new Map(attachments.map((attachment) => {
      const signed = this.tokenService.signAttachment(
        record.id,
        attachment.key,
        record.expiresAt,
      );
      const keyToken = Buffer.from(attachment.key, "utf8").toString("base64url");
      const url = `/api/shared-files/${encodeURIComponent(record.id)}/${keyToken}`
        + `?expiresAt=${signed.expiresAt}&signature=${signed.signature}`;
      return [attachment.key, url];
    }));
    const snapshot = createSharedDocumentSnapshot(document, {
      expiresAt: record.expiresAt,
      signedAttachmentUrls,
    });

    await this.recordAccessAudit(record, "document_share.accessed");
    return snapshot;
  }

  async loadSharedAttachment(input: {
    expiresAt: number;
    keyToken: string;
    shareId: string;
    signature: string;
  }): Promise<StoredObject> {
    const record = await this.findShareById(input.shareId);
    if (!record) {
      throw new DocumentShareNotFoundError();
    }
    if (this.isGone(record)) {
      await this.recordAccessAudit(
        record,
        "document_share_attachment.access_denied",
        "share-gone",
      );
      throw new DocumentShareGoneError();
    }

    const objectKey = decodeObjectKey(input.keyToken);
    if (
      !objectKey
      || !this.tokenService.verifyAttachment({
        expiresAt: input.expiresAt,
        objectKey,
        shareId: record.id,
        signature: input.signature,
      })
    ) {
      await this.recordAccessAudit(
        record,
        "document_share_attachment.access_denied",
        "invalid-signature",
      );
      throw new DocumentShareNotFoundError();
    }

    const attachment = await this.attachmentStore.findDocumentAttachment(
      objectKey,
      record.workspaceId,
      record.documentId,
    );
    if (!attachment) {
      await this.recordAccessAudit(
        record,
        "document_share_attachment.access_denied",
        "attachment-not-found",
      );
      throw new DocumentShareNotFoundError();
    }

    let object: StoredObject;
    try {
      object = await this.objectStorage.getObject(objectKey);
    } catch {
      await this.recordAccessAudit(
        record,
        "document_share_attachment.access_denied",
        "object-not-found",
      );
      throw new DocumentShareNotFoundError();
    }

    await this.recordAccessAudit(record, "document_share_attachment.accessed");
    return object;
  }

  private async findShareById(shareId: string) {
    return this.findShare("links.id = $1", shareId);
  }

  private async findShareByToken(rawToken: string) {
    const tokenHash = this.tokenService.hashRawToken(rawToken);
    return this.findShare("links.token_hash = $1", tokenHash);
  }

  private async findShare(condition: string, value: string): Promise<DocumentShareRecord | null> {
    const result = await this.pool.query(
      `SELECT links.id, links.workspace_id, links.document_id, links.expires_at,
              links.revoked_at, workspaces.name AS workspace_name,
              workspaces.deleted_at AS workspace_deleted_at
       FROM document_share_links links
       INNER JOIN editor_documents documents
         ON documents.workspace_id = links.workspace_id AND documents.id = links.document_id
       INNER JOIN editor_workspaces workspaces ON workspaces.id = links.workspace_id
       WHERE ${condition}
       LIMIT 1`,
      [value],
    );
    const row = result.rows[0];

    return row
      ? {
          documentId: String(row.document_id),
          expiresAt: Number(row.expires_at),
          id: String(row.id),
          revokedAt: row.revoked_at === null ? null : Number(row.revoked_at),
          workspaceDeletedAt: row.workspace_deleted_at === null
            ? null
            : Number(row.workspace_deleted_at),
          workspaceId: String(row.workspace_id),
          workspaceName: String(row.workspace_name),
        }
      : null;
  }

  private isGone(record: DocumentShareRecord) {
    return record.revokedAt !== null
      || record.workspaceDeletedAt !== null
      || record.expiresAt <= this.now();
  }

  private async loadDocument(workspaceId: string, documentId: string): Promise<EditorDocument> {
    const [documentResult, blockResult, relationshipResult] = await Promise.all([
      this.pool.query(
        `SELECT id, title, updated_at
         FROM editor_documents
         WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, documentId],
      ),
      this.pool.query(
        `SELECT id, type, heading_level, content, data, checked, assignee, due_date,
                status, parent_id, position, created_at, updated_at
         FROM editor_blocks
         WHERE workspace_id = $1 AND document_id = $2
         ORDER BY position ASC`,
        [workspaceId, documentId],
      ),
      this.pool.query(
        `SELECT relationships.parent_block_id, relationships.child_block_id
         FROM block_relationships relationships
         INNER JOIN editor_blocks blocks
           ON blocks.workspace_id = relationships.workspace_id
          AND blocks.id = relationships.parent_block_id
         WHERE relationships.workspace_id = $1 AND blocks.document_id = $2
         ORDER BY relationships.position ASC`,
        [workspaceId, documentId],
      ),
    ]);
    const document = documentResult.rows[0];
    if (!document) {
      throw new DocumentShareGoneError();
    }

    const childrenByBlock = new Map<string, string[]>();
    for (const relationship of relationshipResult.rows) {
      const parentId = String(relationship.parent_block_id);
      childrenByBlock.set(parentId, [
        ...(childrenByBlock.get(parentId) ?? []),
        String(relationship.child_block_id),
      ]);
    }

    return {
      blocks: blockResult.rows.map((block): Block => ({
        assignee: String(block.assignee),
        checked: Boolean(block.checked),
        children: childrenByBlock.get(String(block.id)) ?? [],
        comments: [],
        content: String(block.content),
        createdAt: Number(block.created_at),
        data: block.data && typeof block.data === "object"
          ? block.data as Block["data"]
          : null,
        dueDate: String(block.due_date),
        headingLevel: Number(block.heading_level) as HeadingLevel,
        id: String(block.id),
        parentId: block.parent_id === null ? null : String(block.parent_id),
        status: block.status as Block["status"],
        type: block.type as Block["type"],
        updatedAt: Number(block.updated_at),
      })),
      id: String(document.id),
      title: String(document.title),
      updatedAt: Number(document.updated_at),
    };
  }

  private async recordAccessAudit(
    record: DocumentShareRecord,
    eventType: string,
    reason?: string,
  ) {
    const client = await this.pool.connect();
    try {
      await this.auditStore.write(client, {
        actorUserId: null,
        eventType,
        metadata: {
          documentId: record.documentId,
          expiresAt: record.expiresAt,
          ...(reason ? { reason } : {}),
          shareId: record.id,
        },
        targetId: record.id,
        targetType: "document_share",
        workspaceId: record.workspaceId,
        workspaceName: record.workspaceName,
      });
    } finally {
      client.release();
    }
  }
}

function decodeObjectKey(keyToken: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(keyToken)) {
    return null;
  }
  const objectKey = Buffer.from(keyToken, "base64url").toString("utf8");
  return Buffer.from(objectKey, "utf8").toString("base64url") === keyToken
    ? objectKey
    : null;
}
