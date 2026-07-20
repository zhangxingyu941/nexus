import type { Pool } from "pg";
import type {
  Block,
  BlockComment,
  EditorDocument,
  HeadingLevel,
} from "../features/editor/model/block";
import type { DocumentAccess } from "../shared/documentAccess";
import { DocumentAuthorizationService, DocumentNotFoundError } from "./documentAuthorization";

export interface DocumentSnapshot {
  access: DocumentAccess;
  document: EditorDocument;
}

export class PostgresDocumentStore {
  constructor(
    private readonly pool: Pool,
    private readonly authorization: DocumentAuthorizationService,
  ) {}

  async loadDocument(userId: string, publicId: string): Promise<DocumentSnapshot> {
    const access = await this.authorization.requireUserAction(userId, publicId, "read");
    const documentResult = await this.pool.query(
      `SELECT id, title, template_id, pinned, updated_at
       FROM editor_documents
       WHERE workspace_id = $1 AND id = $2`,
      [access.workspaceId, access.documentId],
    );
    const row = documentResult.rows[0];
    if (!row) {
      throw new DocumentNotFoundError();
    }

    const [blockResult, commentResult, relationshipResult] = await Promise.all([
      this.pool.query(
        `SELECT id, type, heading_level, content, data, checked, assignee, due_date,
                status, parent_id, position, created_at, updated_at
         FROM editor_blocks
         WHERE workspace_id = $1 AND document_id = $2
         ORDER BY position ASC`,
        [access.workspaceId, access.documentId],
      ),
      this.pool.query(
        `SELECT comments.id, comments.block_id, comments.author, comments.body,
                comments.time_label, comments.created_at, comments.resolved, comments.resolved_at
         FROM block_comments comments
         INNER JOIN editor_blocks blocks
           ON blocks.workspace_id = comments.workspace_id AND blocks.id = comments.block_id
         WHERE comments.workspace_id = $1 AND blocks.document_id = $2
         ORDER BY comments.created_at ASC`,
        [access.workspaceId, access.documentId],
      ),
      this.pool.query(
        `SELECT relationships.parent_block_id, relationships.child_block_id
         FROM block_relationships relationships
         INNER JOIN editor_blocks blocks
           ON blocks.workspace_id = relationships.workspace_id
          AND blocks.id = relationships.parent_block_id
         WHERE relationships.workspace_id = $1 AND blocks.document_id = $2
         ORDER BY relationships.position ASC`,
        [access.workspaceId, access.documentId],
      ),
    ]);

    const commentsByBlock = new Map<string, BlockComment[]>();
    for (const comment of commentResult.rows) {
      const blockId = String(comment.block_id);
      const value: BlockComment = {
        author: String(comment.author),
        body: String(comment.body),
        createdAt: Number(comment.created_at),
        id: String(comment.id),
        resolved: Boolean(comment.resolved),
        time: String(comment.time_label),
      };
      if (comment.resolved_at !== null && comment.resolved_at !== undefined) {
        value.resolvedAt = Number(comment.resolved_at);
      }
      commentsByBlock.set(blockId, [...(commentsByBlock.get(blockId) ?? []), value]);
    }

    const childrenByBlock = new Map<string, string[]>();
    for (const relationship of relationshipResult.rows) {
      const parentId = String(relationship.parent_block_id);
      childrenByBlock.set(parentId, [
        ...(childrenByBlock.get(parentId) ?? []),
        String(relationship.child_block_id),
      ]);
    }

    const document: EditorDocument = {
      blocks: blockResult.rows.map((block) => ({
        assignee: String(block.assignee),
        checked: Boolean(block.checked),
        children: childrenByBlock.get(String(block.id)) ?? [],
        comments: commentsByBlock.get(String(block.id)) ?? [],
        content: String(block.content),
        createdAt: Number(block.created_at),
        data: block.data && typeof block.data === "object" ? block.data as Block["data"] : null,
        dueDate: String(block.due_date),
        headingLevel: Number(block.heading_level) as HeadingLevel,
        id: String(block.id),
        parentId: block.parent_id === null ? null : String(block.parent_id),
        status: block.status as Block["status"],
        type: block.type as Block["type"],
        updatedAt: Number(block.updated_at),
      })),
      id: String(row.id),
      title: String(row.title),
      updatedAt: Number(row.updated_at),
    };
    if (row.template_id !== null && row.template_id !== undefined) {
      document.templateId = String(row.template_id);
    }
    if (row.pinned !== null && row.pinned !== undefined) {
      document.pinned = Boolean(row.pinned);
    }

    return { access, document };
  }

  async saveDocument(
    userId: string,
    publicId: string,
    document: EditorDocument,
  ): Promise<DocumentSnapshot> {
    const access = await this.authorization.requireUserAction(userId, publicId, "write");
    if (document.id !== access.documentId) {
      throw new DocumentNotFoundError();
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query(
        `UPDATE editor_documents
         SET title = $1, template_id = $2, pinned = $3, updated_at = $4
         WHERE workspace_id = $5 AND id = $6`,
        [
          document.title,
          document.templateId ?? null,
          document.pinned ?? null,
          document.updatedAt,
          access.workspaceId,
          access.documentId,
        ],
      );
      if (updated.rowCount !== 1) {
        throw new DocumentNotFoundError();
      }

      await client.query(
        `DELETE FROM editor_blocks
         WHERE workspace_id = $1 AND document_id = $2`,
        [access.workspaceId, access.documentId],
      );

      for (const [position, block] of document.blocks.entries()) {
        await client.query(
          `INSERT INTO editor_blocks
           (workspace_id, id, document_id, type, heading_level, content, data, checked, assignee, due_date,
            status, parent_id, position, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15)`,
          [
            access.workspaceId,
            block.id,
            access.documentId,
            block.type,
            block.headingLevel,
            block.content,
            block.data ? JSON.stringify(block.data) : null,
            block.checked,
            block.assignee,
            block.dueDate,
            block.status,
            block.parentId,
            position,
            block.createdAt,
            block.updatedAt,
          ],
        );
        for (const comment of block.comments) {
          await client.query(
            `INSERT INTO block_comments
             (workspace_id, id, block_id, author, body, time_label, created_at, resolved, resolved_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              access.workspaceId,
              comment.id,
              block.id,
              comment.author,
              comment.body,
              comment.time,
              comment.createdAt,
              comment.resolved,
              comment.resolvedAt ?? null,
            ],
          );
        }
      }

      for (const block of document.blocks) {
        for (const [position, childId] of block.children.entries()) {
          await client.query(
            `INSERT INTO block_relationships (workspace_id, parent_block_id, child_block_id, position)
             VALUES ($1, $2, $3, $4)`,
            [access.workspaceId, block.id, childId, position],
          );
        }
      }

      await client.query(
        "UPDATE editor_workspaces SET updated_at = $1 WHERE id = $2",
        [document.updatedAt, access.workspaceId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.loadDocument(userId, publicId);
  }
}
