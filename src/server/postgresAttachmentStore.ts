import type { Pool } from "pg";

export interface DocumentAttachment {
  documentId: string;
  key: string;
  workspaceId: string;
}

export class PostgresAttachmentStore {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async createAttachment(attachment: DocumentAttachment) {
    await this.pool.query(
      `INSERT INTO document_attachments (object_key, workspace_id, document_id, created_at)
       VALUES ($1, $2, $3, $4)`,
      [attachment.key, attachment.workspaceId, attachment.documentId, Date.now()],
    );
  }

  async findAttachment(key: string): Promise<DocumentAttachment | null> {
    const result = await this.pool.query(
      `SELECT object_key, workspace_id, document_id
       FROM document_attachments
       WHERE object_key = $1`,
      [key],
    );
    const row = result.rows[0];
    return row
      ? {
          documentId: String(row.document_id),
          key: String(row.object_key),
          workspaceId: String(row.workspace_id),
        }
      : null;
  }
}
