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
    return mapAttachment(result.rows[0]);
  }

  async findDocumentAttachment(
    key: string,
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentAttachment | null> {
    const result = await this.pool.query(
      `SELECT object_key, workspace_id, document_id
       FROM document_attachments
       WHERE object_key = $1 AND workspace_id = $2 AND document_id = $3`,
      [key, workspaceId, documentId],
    );

    return mapAttachment(result.rows[0]);
  }

  async listDocumentAttachments(
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentAttachment[]> {
    const result = await this.pool.query(
      `SELECT object_key, workspace_id, document_id
       FROM document_attachments
       WHERE workspace_id = $1 AND document_id = $2
       ORDER BY created_at ASC, object_key ASC`,
      [workspaceId, documentId],
    );

    return result.rows.map((row) => mapAttachment(row)!);
  }
}

function mapAttachment(row: Record<string, unknown> | undefined) {
  return row
    ? {
        documentId: String(row.document_id),
        key: String(row.object_key),
        workspaceId: String(row.workspace_id),
      }
    : null;
}
