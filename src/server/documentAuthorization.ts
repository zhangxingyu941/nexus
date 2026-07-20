import type { Pool } from "pg";
import type {
  DocumentAccess,
  DocumentAccessMode,
  DocumentAction,
  DocumentPermissionRole,
} from "../shared/documentAccess";
import type { WorkspaceRole } from "./postgresWorkspaceStore";

export interface DocumentAuthorizationRecord {
  accessMode: DocumentAccessMode;
  documentCreatedBy: string;
  documentId: string;
  explicitRole: DocumentPermissionRole | null;
  publicId: string;
  workspaceId: string;
  workspaceRole: WorkspaceRole | null;
}

export interface DocumentAuthorizationRecords {
  findRecord(userId: string, documentId: string): Promise<DocumentAuthorizationRecord | null>;
  findWorkspaceDocumentRecord(
    userId: string,
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentAuthorizationRecord | null>;
}

export class PostgresDocumentAuthorizationRecords implements DocumentAuthorizationRecords {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async findRecord(
    userId: string,
    publicId: string,
  ): Promise<DocumentAuthorizationRecord | null> {
    const result = await this.pool.query(
      `SELECT documents.workspace_id, documents.id AS document_id, documents.public_id,
              documents.created_by, documents.access_mode, members.role AS workspace_role,
              permissions.role AS explicit_role
       FROM editor_documents documents
       INNER JOIN editor_workspaces workspaces ON workspaces.id = documents.workspace_id
       LEFT JOIN workspace_members members
         ON members.workspace_id = documents.workspace_id AND members.user_id = $1
       LEFT JOIN document_permissions permissions
         ON permissions.workspace_id = documents.workspace_id
        AND permissions.document_id = documents.id
        AND permissions.user_id = $1
       WHERE documents.public_id = $2 AND workspaces.deleted_at IS NULL
       LIMIT 1`,
      [userId, publicId],
    );
    const row = result.rows[0];

    return row
      ? {
          accessMode: row.access_mode as DocumentAccessMode,
          documentCreatedBy: String(row.created_by),
          documentId: String(row.document_id),
          explicitRole: row.explicit_role as DocumentPermissionRole | null,
          publicId: String(row.public_id),
          workspaceId: String(row.workspace_id),
          workspaceRole: row.workspace_role as WorkspaceRole | null,
        }
      : null;
  }

  async findWorkspaceDocumentRecord(
    userId: string,
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentAuthorizationRecord | null> {
    const result = await this.pool.query(
      `SELECT documents.workspace_id, documents.id AS document_id, documents.public_id,
              documents.created_by, documents.access_mode, members.role AS workspace_role,
              permissions.role AS explicit_role
       FROM editor_documents documents
       INNER JOIN editor_workspaces workspaces ON workspaces.id = documents.workspace_id
       LEFT JOIN workspace_members members
         ON members.workspace_id = documents.workspace_id AND members.user_id = $1
       LEFT JOIN document_permissions permissions
         ON permissions.workspace_id = documents.workspace_id
        AND permissions.document_id = documents.id
        AND permissions.user_id = $1
       WHERE documents.workspace_id = $2 AND documents.id = $3 AND workspaces.deleted_at IS NULL
       LIMIT 1`,
      [userId, workspaceId, documentId],
    );
    const row = result.rows[0];

    return row
      ? {
          accessMode: row.access_mode as DocumentAccessMode,
          documentCreatedBy: String(row.created_by),
          documentId: String(row.document_id),
          explicitRole: row.explicit_role as DocumentPermissionRole | null,
          publicId: String(row.public_id),
          workspaceId: String(row.workspace_id),
          workspaceRole: row.workspace_role as WorkspaceRole | null,
        }
      : null;
  }
}

export class DocumentNotFoundError extends Error {
  constructor() {
    super("文档不存在或无权访问");
    this.name = "DocumentNotFoundError";
  }
}

export class DocumentAuthorizationService {
  constructor(private readonly records: DocumentAuthorizationRecords) {}

  async resolveUserAccess(userId: string, documentId: string): Promise<DocumentAccess | null> {
    const record = await this.records.findRecord(userId, documentId);
    return this.resolveRecord(userId, record);
  }

  async resolveWorkspaceDocumentAccess(
    userId: string,
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentAccess | null> {
    const record = await this.records.findWorkspaceDocumentRecord(userId, workspaceId, documentId);
    return this.resolveRecord(userId, record);
  }

  async requireWorkspaceDocumentAction(
    userId: string,
    workspaceId: string,
    documentId: string,
    action: DocumentAction,
  ) {
    const access = await this.resolveWorkspaceDocumentAccess(userId, workspaceId, documentId);
    if (!access || !isAllowed(access, action)) {
      throw new DocumentNotFoundError();
    }
    return access;
  }

  private resolveRecord(
    userId: string,
    record: DocumentAuthorizationRecord | null,
  ): DocumentAccess | null {
    if (!record) {
      return null;
    }

    if (record.workspaceRole === "owner") {
      return createAccess(record, "owner", "workspace-owner", true, true);
    }

    if (record.documentCreatedBy === userId) {
      return createAccess(record, "editor", "author", false, true);
    }

    if (record.workspaceRole && record.explicitRole) {
      return createAccess(
        record,
        record.explicitRole,
        "explicit",
        false,
        record.explicitRole === "editor",
      );
    }

    if (record.accessMode === "private" || !record.workspaceRole) {
      return null;
    }

    return createAccess(
      record,
      record.workspaceRole,
      "workspace",
      false,
      record.workspaceRole !== "viewer",
    );
  }

  async requireUserAction(userId: string, documentId: string, action: DocumentAction) {
    const access = await this.resolveUserAccess(userId, documentId);
    if (!access || !isAllowed(access, action)) {
      throw new DocumentNotFoundError();
    }
    return access;
  }
}

function createAccess(
  record: DocumentAuthorizationRecord,
  role: DocumentAccess["role"],
  source: DocumentAccess["source"],
  canManage: boolean,
  canWrite: boolean,
): DocumentAccess {
  return {
    accessMode: record.accessMode,
    canManage,
    canRead: true,
    canWrite,
    documentId: record.documentId,
    publicId: record.publicId,
    role,
    source,
    workspaceId: record.workspaceId,
  };
}

function isAllowed(access: DocumentAccess, action: DocumentAction) {
  if (action === "read") {
    return access.canRead;
  }
  if (action === "write") {
    return access.canWrite;
  }
  return access.canManage;
}
