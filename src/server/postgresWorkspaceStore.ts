import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  Block,
  BlockComment,
  EditorDocument,
  EditorWorkspace,
  HeadingLevel,
} from "../features/editor/model/block";
import { createDefaultWorkspace } from "../features/editor/model/workspaceOperations";
import {
  normalizeWorkspaceName,
  sortWorkspaceSummaries,
  type WorkspaceCatalog,
  type WorkspaceRole as SharedWorkspaceRole,
  type WorkspaceSnapshot,
  type WorkspaceSummary,
} from "../shared/workspace";
import { WorkspaceDomainError } from "./workspaceErrors";

export type WorkspaceRole = SharedWorkspaceRole;

export interface DocumentVersionSummary {
  id: string;
  documentId: string;
  title: string;
  createdAt: number;
  createdBy: string;
}

interface PostgresWorkspaceStoreOptions {
  idFactory?: () => string;
  now?: () => number;
}

export interface WorkspaceAccess {
  role: WorkspaceRole;
  workspaceId: string;
}

export class WorkspacePermissionError extends Error {
  constructor(message = "没有修改此工作区的权限") {
    super(message);
    this.name = "WorkspacePermissionError";
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor() {
    super("工作区不存在");
    this.name = "WorkspaceNotFoundError";
  }
}

export class PostgresWorkspaceStore {
  private readonly idFactory: () => string;
  private readonly now: () => number;

  constructor(
    private readonly pool: Pool,
    options: PostgresWorkspaceStoreOptions = {},
  ) {
    this.idFactory = options.idFactory ?? (() => `workspace-${randomUUID()}`);
    this.now = options.now ?? Date.now;
  }

  async ensurePersonalWorkspace(
    userId: string,
    name: string,
    executor: Pick<Pool, "query"> | Pick<PoolClient, "query"> = this.pool,
  ) {
    const existingAccess = await this.findAnyAccess(executor, userId);

    if (existingAccess) {
      await this.ensureDefaultDocument(
        executor,
        userId,
        existingAccess.workspaceId,
      );
      return existingAccess.workspaceId;
    }

    if (executor !== this.pool) {
      const workspaceId = this.idFactory();
      const now = this.now();
      await executor.query(
        `INSERT INTO editor_workspaces (id, name, updated_at, created_at)
         VALUES ($1, $2, $3, $3)`,
        [workspaceId, name.trim() || "我的工作区", now],
      );
      await executor.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
         VALUES ($1, $2, 'owner', $3)`,
        [workspaceId, userId, now],
      );
      await executor.query(
        `INSERT INTO workspace_preferences (user_id, selected_workspace_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
         SET selected_workspace_id = EXCLUDED.selected_workspace_id`,
        [userId, workspaceId],
      );
      await this.ensureDefaultDocument(executor, userId, workspaceId);
      return workspaceId;
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const access = await this.findAnyAccess(client, userId);
      if (access) {
        await client.query("COMMIT");
        await this.ensureDefaultDocument(client, userId, access.workspaceId);
        return access.workspaceId;
      }

      const workspaceId = this.idFactory();
      const now = this.now();

      await client.query(
        `INSERT INTO editor_workspaces (id, name, updated_at, created_at)
         VALUES ($1, $2, $3, $3)`,
        [workspaceId, name.trim() || "我的工作区", now],
      );
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
         VALUES ($1, $2, 'owner', $3)`,
        [workspaceId, userId, now],
      );
      await client.query(
        `INSERT INTO workspace_preferences (user_id, selected_workspace_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
         SET selected_workspace_id = EXCLUDED.selected_workspace_id`,
        [userId, workspaceId],
      );
      await this.ensureDefaultDocument(client, userId, workspaceId);
      await client.query("COMMIT");

      return workspaceId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listWorkspaces(userId: string): Promise<WorkspaceCatalog> {
    const result = await this.pool.query(
      `SELECT workspaces.id, workspaces.name, workspaces.created_at, workspaces.updated_at,
              members.role, preferences.selected_workspace_id
       FROM workspace_members members
       INNER JOIN editor_workspaces workspaces ON workspaces.id = members.workspace_id
       LEFT JOIN workspace_preferences preferences ON preferences.user_id = members.user_id
       WHERE members.user_id = $1 AND workspaces.deleted_at IS NULL
       ORDER BY workspaces.created_at ASC, workspaces.id ASC`,
      [userId],
    );

    if (result.rows.length === 0) {
      throw new WorkspaceNotFoundError();
    }

    const selectedWorkspaceId = result.rows.find(
      (row) => row.selected_workspace_id === row.id,
    )?.id;
    const currentWorkspaceId = selectedWorkspaceId
      ? String(selectedWorkspaceId)
      : String(result.rows[0].id);

    if (!selectedWorkspaceId) {
      await this.pool.query(
        `INSERT INTO workspace_preferences (user_id, selected_workspace_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
         SET selected_workspace_id = EXCLUDED.selected_workspace_id`,
        [userId, currentWorkspaceId],
      );
    }

    return {
      currentWorkspaceId,
      workspaces: sortWorkspaceSummaries(
        result.rows.map((row) => toWorkspaceSummary(row)),
        currentWorkspaceId,
      ),
    };
  }

  async createWorkspace(
    userId: string,
    nameInput: string,
  ): Promise<WorkspaceSnapshot> {
    const name = normalizeWorkspaceName(nameInput);
    const client = await this.pool.connect();
    const workspaceId = this.idFactory();
    const now = this.now();

    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO editor_workspaces (id, name, updated_at, created_at)
         VALUES ($1, $2, $3, $3)`,
        [workspaceId, name, now],
      );
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
         VALUES ($1, $2, 'owner', $3)`,
        [workspaceId, userId, now],
      );
      await this.ensureDefaultDocument(client, userId, workspaceId);
      await client.query(
        `INSERT INTO workspace_preferences (user_id, selected_workspace_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
         SET selected_workspace_id = EXCLUDED.selected_workspace_id`,
        [userId, workspaceId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.loadWorkspace(userId, workspaceId);
  }

  async selectWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceSnapshot> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const access = await this.requireActiveAccess(client, userId, workspaceId);
      await this.ensureDefaultDocument(client, userId, workspaceId);
      await client.query(
        `INSERT INTO workspace_preferences (user_id, selected_workspace_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
         SET selected_workspace_id = EXCLUDED.selected_workspace_id`,
        [userId, workspaceId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.loadWorkspace(userId, workspaceId);
  }

  async renameWorkspace(
    userId: string,
    workspaceId: string,
    nameInput: string,
  ): Promise<WorkspaceSummary> {
    const name = normalizeWorkspaceName(nameInput);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const access = await this.requireActiveAccess(client, userId, workspaceId);
      if (access.role !== "owner") {
        throw new WorkspacePermissionError("只有工作区所有者可以重命名");
      }

      const result = await client.query(
        `UPDATE editor_workspaces
         SET name = $1, updated_at = $2
         WHERE id = $3
         RETURNING id, name, created_at, updated_at`,
        [name, this.now(), workspaceId],
      );
      await client.query("COMMIT");
      return toWorkspaceSummary({ ...result.rows[0], role: access.role });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async loadWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceSnapshot> {
    const access = await this.requireActiveAccess(this.pool, userId, workspaceId);

    await this.ensureDefaultDocument(this.pool, userId, access.workspaceId);

    const workspaceResult = await this.pool.query(
      `SELECT document_preferences.active_document_id, workspaces.updated_at
       FROM editor_workspaces workspaces
       LEFT JOIN workspace_document_preferences document_preferences
         ON document_preferences.workspace_id = workspaces.id
        AND document_preferences.user_id = $1
       WHERE workspaces.id = $2`,
      [userId, access.workspaceId],
    );
    const workspaceRow = workspaceResult.rows[0];

    if (!workspaceRow?.active_document_id) {
      throw new WorkspaceNotFoundError();
    }

    const documentResult = await this.pool.query(
      `SELECT id, title, template_id, pinned, updated_at
       FROM editor_documents
       WHERE workspace_id = $1
       ORDER BY position ASC`,
      [access.workspaceId],
    );
    if (documentResult.rows.length === 0) {
      throw new WorkspaceNotFoundError();
    }

    const blockResult = await this.pool.query(
      `SELECT blocks.id, blocks.document_id, blocks.type, blocks.heading_level, blocks.content, blocks.data, blocks.checked,
              blocks.assignee, blocks.due_date, blocks.status, blocks.parent_id,
              blocks.created_at, blocks.updated_at
       FROM editor_blocks blocks
       INNER JOIN editor_documents documents
         ON documents.workspace_id = blocks.workspace_id
        AND documents.id = blocks.document_id
       WHERE blocks.workspace_id = $1
       ORDER BY documents.position ASC, blocks.position ASC`,
      [access.workspaceId],
    );
    const commentResult = await this.pool.query(
      `SELECT comments.id, comments.block_id, comments.author, comments.body,
              comments.time_label, comments.created_at, comments.resolved, comments.resolved_at
       FROM block_comments comments
       INNER JOIN editor_blocks blocks
         ON blocks.workspace_id = comments.workspace_id
        AND blocks.id = comments.block_id
       INNER JOIN editor_documents documents
         ON documents.workspace_id = blocks.workspace_id
        AND documents.id = blocks.document_id
       WHERE comments.workspace_id = $1
       ORDER BY comments.created_at ASC`,
      [access.workspaceId],
    );
    const relationshipResult = await this.pool.query(
      `SELECT relationships.parent_block_id, relationships.child_block_id
       FROM block_relationships relationships
       INNER JOIN editor_blocks blocks
         ON blocks.workspace_id = relationships.workspace_id
        AND blocks.id = relationships.parent_block_id
       INNER JOIN editor_documents documents
         ON documents.workspace_id = blocks.workspace_id
        AND documents.id = blocks.document_id
       WHERE relationships.workspace_id = $1
       ORDER BY relationships.position ASC`,
      [access.workspaceId],
    );

    const commentsByBlock = new Map<string, BlockComment[]>();
    for (const row of commentResult.rows) {
      const blockId = String(row.block_id);
      const comment: BlockComment = {
        author: String(row.author),
        body: String(row.body),
        createdAt: Number(row.created_at),
        id: String(row.id),
        resolved: Boolean(row.resolved),
        time: String(row.time_label),
      };

      if (row.resolved_at !== null && row.resolved_at !== undefined) {
        comment.resolvedAt = Number(row.resolved_at);
      }

      commentsByBlock.set(blockId, [
        ...(commentsByBlock.get(blockId) ?? []),
        comment,
      ]);
    }

    const childrenByBlock = new Map<string, string[]>();
    for (const row of relationshipResult.rows) {
      const parentId = String(row.parent_block_id);
      childrenByBlock.set(parentId, [
        ...(childrenByBlock.get(parentId) ?? []),
        String(row.child_block_id),
      ]);
    }

    const blocksByDocument = new Map<string, Block[]>();
    for (const row of blockResult.rows) {
      const documentId = String(row.document_id);
      const blockId = String(row.id);
      const block: Block = {
        assignee: String(row.assignee),
        checked: Boolean(row.checked),
        children: childrenByBlock.get(blockId) ?? [],
        comments: commentsByBlock.get(blockId) ?? [],
        content: String(row.content),
        createdAt: Number(row.created_at),
        data:
          row.data && typeof row.data === "object"
            ? (row.data as Block["data"])
            : null,
        dueDate: String(row.due_date),
        headingLevel: Number(row.heading_level) as HeadingLevel,
        id: blockId,
        parentId: row.parent_id === null ? null : String(row.parent_id),
        status: row.status as Block["status"],
        type: row.type as Block["type"],
        updatedAt: Number(row.updated_at),
      };
      blocksByDocument.set(documentId, [
        ...(blocksByDocument.get(documentId) ?? []),
        block,
      ]);
    }

    const documents = documentResult.rows.map((row) => {
      const document: EditorDocument = {
        blocks: blocksByDocument.get(String(row.id)) ?? [],
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

      return document;
    });

    const content: EditorWorkspace = {
      activeDocumentId: String(workspaceRow.active_document_id),
      documents,
      updatedAt: Number(workspaceRow.updated_at),
    };

    const summaryResult = await this.pool.query(
      `SELECT id, name, created_at, updated_at
       FROM editor_workspaces
       WHERE id = $1`,
      [workspaceId],
    );
    return {
      content,
      summary: toWorkspaceSummary({
        ...summaryResult.rows[0],
        role: access.role,
      }),
    };
  }

  async saveWorkspace(
    userId: string,
    workspaceId: string,
    workspace: EditorWorkspace,
  ): Promise<EditorWorkspace> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const access = await this.requireActiveAccess(client, userId, workspaceId);
      if (access.role === "viewer") {
        throw new WorkspacePermissionError();
      }

      const documentPreferencesResult = await client.query(
        `SELECT user_id, active_document_id, updated_at
         FROM workspace_document_preferences
         WHERE workspace_id = $1
         FOR UPDATE`,
        [access.workspaceId],
      );
      const documentAuthorsResult = await client.query(
        `SELECT id, created_by, public_id
         FROM editor_documents
         WHERE workspace_id = $1`,
        [access.workspaceId],
      );
      const persistedDocuments = new Map(
        documentAuthorsResult.rows.map((row) => [
          String(row.id),
          {
            createdBy: String(row.created_by),
            publicId: String(row.public_id),
          },
        ]),
      );

      await client.query(
        "UPDATE editor_workspaces SET updated_at = $1 WHERE id = $2",
        [workspace.updatedAt, access.workspaceId],
      );
      await client.query(
        "DELETE FROM editor_documents WHERE workspace_id = $1",
        [access.workspaceId],
      );

      for (const [
        documentPosition,
        document,
      ] of workspace.documents.entries()) {
        const persistedDocument = persistedDocuments.get(document.id);
        await this.insertDocument(
          client,
          access.workspaceId,
          persistedDocument?.createdBy ?? userId,
          persistedDocument?.publicId ?? `document-${randomUUID()}`,
          document,
          documentPosition,
        );
      }

      for (const document of workspace.documents) {
        for (const block of document.blocks) {
          for (const [childPosition, childId] of block.children.entries()) {
            await client.query(
              `INSERT INTO block_relationships (workspace_id, parent_block_id, child_block_id, position)
               VALUES ($1, $2, $3, $4)`,
              [access.workspaceId, block.id, childId, childPosition],
            );
          }
        }
      }

      for (const document of workspace.documents) {
        await this.insertDocumentVersion(
          client,
          access.workspaceId,
          userId,
          document,
        );
      }

      const documentIds = new Set(
        workspace.documents.map((document) => document.id),
      );
      const savedPreferences = new Map(
        documentPreferencesResult.rows.map((row) => [String(row.user_id), row]),
      );
      savedPreferences.set(userId, {
        active_document_id: workspace.activeDocumentId,
        updated_at: workspace.updatedAt,
        user_id: userId,
      });

      for (const [preferenceUserId, preference] of savedPreferences) {
        const previousActiveDocumentId =
          preference.active_document_id === null
            ? null
            : String(preference.active_document_id);
        const activeDocumentId =
          preferenceUserId === userId
            ? workspace.activeDocumentId
            : previousActiveDocumentId &&
                documentIds.has(previousActiveDocumentId)
              ? previousActiveDocumentId
              : null;

        await client.query(
          `INSERT INTO workspace_document_preferences
             (user_id, workspace_id, active_document_id, updated_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id, workspace_id) DO UPDATE
           SET active_document_id = EXCLUDED.active_document_id,
               updated_at = EXCLUDED.updated_at`,
          [
            preferenceUserId,
            access.workspaceId,
            activeDocumentId,
            preferenceUserId === userId
              ? workspace.updatedAt
              : Number(preference.updated_at),
          ],
        );
      }

      await client.query("COMMIT");
      return workspace;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getWorkspaceAccess(userId: string, workspaceId: string) {
    return this.findAccess(this.pool, userId, workspaceId);
  }

  async getDocumentAccess(
    userId: string,
    workspaceId: string,
    documentId: string,
  ): Promise<WorkspaceAccess | null> {
    const result = await this.pool.query(
      `SELECT members.workspace_id, members.role
       FROM workspace_members members
       INNER JOIN editor_documents documents
         ON documents.workspace_id = members.workspace_id
       INNER JOIN editor_workspaces workspaces
         ON workspaces.id = members.workspace_id
       WHERE members.user_id = $1
         AND members.workspace_id = $2
         AND documents.id = $3
         AND workspaces.deleted_at IS NULL
       LIMIT 1`,
      [userId, workspaceId, documentId],
    );
    const row = result.rows[0];

    return row
      ? {
          role: row.role as WorkspaceRole,
          workspaceId: String(row.workspace_id),
        }
      : null;
  }

  async listDocumentVersions(
    userId: string,
    workspaceId: string,
    documentId: string,
  ): Promise<DocumentVersionSummary[]> {
    const access = await this.getDocumentAccess(
      userId,
      workspaceId,
      documentId,
    );

    if (!access) {
      throw new WorkspaceNotFoundError();
    }

    const result = await this.pool.query(
      `SELECT versions.id, versions.document_id, versions.title, versions.created_at,
              users.display_name AS created_by_name
       FROM document_versions versions
       LEFT JOIN app_users users ON users.id = versions.created_by
       WHERE versions.workspace_id = $1 AND versions.document_id = $2
       ORDER BY versions.created_at DESC, versions.id DESC`,
      [workspaceId, documentId],
    );

    return result.rows.map((row) => ({
      createdAt: Number(row.created_at),
      createdBy: row.created_by_name ? String(row.created_by_name) : "团队成员",
      documentId: String(row.document_id),
      id: String(row.id),
      title: String(row.title),
    }));
  }

  async restoreDocumentVersion(
    userId: string,
    workspaceId: string,
    documentId: string,
    versionId: string,
  ) {
    const access = await this.getDocumentAccess(
      userId,
      workspaceId,
      documentId,
    );

    if (!access) {
      throw new WorkspaceNotFoundError();
    }
    if (access.role === "viewer") {
      throw new WorkspacePermissionError("没有恢复此文档版本的权限");
    }

    const versionResult = await this.pool.query(
      `SELECT snapshot
       FROM document_versions
       WHERE workspace_id = $1 AND document_id = $2 AND id = $3`,
      [workspaceId, documentId, versionId],
    );
    const snapshot = versionResult.rows[0]?.snapshot;

    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("文档版本不存在");
    }

    const loaded = await this.loadWorkspace(userId, workspaceId);

    const now = this.now();
    const restoredDocument = snapshot as EditorDocument;
    const nextDocument: EditorDocument = {
      ...restoredDocument,
      blocks: restoredDocument.blocks.map((block) => ({
        ...block,
        updatedAt: now,
      })),
      id: documentId,
      updatedAt: now,
    };
    const nextWorkspace: EditorWorkspace = {
      ...loaded.content,
      documents: loaded.content.documents.map((document) =>
        document.id === documentId ? nextDocument : document,
      ),
      updatedAt: now,
    };

    await this.saveWorkspace(userId, workspaceId, nextWorkspace);
    return nextDocument;
  }

  private async insertDocument(
    client: Pick<PoolClient, "query">,
    workspaceId: string,
    createdBy: string,
    publicId: string,
    document: EditorDocument,
    position: number,
  ) {
    await client.query(
      `INSERT INTO editor_documents
       (id, workspace_id, public_id, created_by, title, template_id, pinned, position, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        document.id,
        workspaceId,
        publicId,
        createdBy,
        document.title,
        document.templateId ?? null,
        document.pinned ?? null,
        position,
        document.updatedAt,
      ],
    );

    for (const [blockPosition, block] of document.blocks.entries()) {
      await client.query(
        `INSERT INTO editor_blocks
         (workspace_id, id, document_id, type, heading_level, content, data, checked, assignee, due_date,
          status, parent_id, position, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          workspaceId,
          block.id,
          document.id,
          block.type,
          block.headingLevel,
          block.content,
          block.data ? JSON.stringify(block.data) : null,
          block.checked,
          block.assignee,
          block.dueDate,
          block.status,
          block.parentId,
          blockPosition,
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
            workspaceId,
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
  }

  private async ensureDefaultDocument(
    executor: Pick<Pool, "query"> | Pick<PoolClient, "query">,
    userId: string,
    workspaceId: string,
  ) {
    const existingDocumentResult = await executor.query(
      `SELECT documents.id
       FROM editor_documents documents
       LEFT JOIN workspace_document_preferences document_preferences
         ON document_preferences.workspace_id = documents.workspace_id
        AND document_preferences.user_id = $1
       WHERE documents.workspace_id = $2
       ORDER BY CASE
                  WHEN documents.id = document_preferences.active_document_id THEN 0
                  ELSE 1
                END,
                documents.position ASC
       LIMIT 1`,
      [userId, workspaceId],
    );
    let activeDocumentId = existingDocumentResult.rows[0]?.id
      ? String(existingDocumentResult.rows[0].id)
      : null;
    const updatedAt = this.now();

    if (!activeDocumentId) {
      const workspace = createDefaultWorkspace(updatedAt);
      activeDocumentId = workspace.activeDocumentId;
      await this.insertDocument(
        executor,
        workspaceId,
        userId,
        `document-${randomUUID()}`,
        workspace.documents[0],
        0,
      );
    }

    await executor.query(
      `INSERT INTO workspace_document_preferences
         (user_id, workspace_id, active_document_id, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, workspace_id) DO UPDATE
       SET active_document_id = EXCLUDED.active_document_id,
           updated_at = EXCLUDED.updated_at`,
      [userId, workspaceId, activeDocumentId, updatedAt],
    );
  }

  private async insertDocumentVersion(
    client: PoolClient,
    workspaceId: string,
    userId: string,
    document: EditorDocument,
  ) {
    const snapshot = JSON.stringify(document);
    const snapshotHash = createHash("sha256").update(snapshot).digest("hex");
    const latestResult = await client.query(
      `SELECT snapshot_hash
       FROM document_versions
       WHERE workspace_id = $1 AND document_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [workspaceId, document.id],
    );

    if (latestResult.rows[0]?.snapshot_hash === snapshotHash) {
      return;
    }

    await client.query(
      `INSERT INTO document_versions
       (workspace_id, id, document_id, title, snapshot, snapshot_hash, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        workspaceId,
        `version-${randomUUID()}`,
        document.id,
        document.title,
        snapshot,
        snapshotHash,
        userId,
        document.updatedAt,
      ],
    );
  }

  private async findAccess(
    executor: Pick<Pool, "query"> | Pick<PoolClient, "query">,
    userId: string,
    workspaceId: string,
  ) {
    const result = await executor.query(
      `SELECT members.workspace_id, members.role
       FROM workspace_members members
       INNER JOIN editor_workspaces workspaces
         ON workspaces.id = members.workspace_id
       WHERE members.user_id = $1
         AND members.workspace_id = $2
         AND workspaces.deleted_at IS NULL
       LIMIT 1`,
      [userId, workspaceId],
    );
    const row = result.rows[0];

    return row
      ? ({
          role: row.role as WorkspaceRole,
          workspaceId: String(row.workspace_id),
        } satisfies WorkspaceAccess)
      : null;
  }

  private async findAnyAccess(
    executor: Pick<Pool, "query"> | Pick<PoolClient, "query">,
    userId: string,
  ) {
    const result = await executor.query(
      `SELECT members.workspace_id, members.role
       FROM workspace_members members
       INNER JOIN editor_workspaces workspaces ON workspaces.id = members.workspace_id
       WHERE members.user_id = $1 AND workspaces.deleted_at IS NULL
       ORDER BY workspaces.created_at ASC, workspaces.id ASC
       LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];

    return row
      ? ({
          role: row.role as WorkspaceRole,
          workspaceId: String(row.workspace_id),
        } satisfies WorkspaceAccess)
      : null;
  }

  private async requireActiveAccess(
    executor: Pick<Pool, "query"> | Pick<PoolClient, "query">,
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceAccess> {
    const access = await this.findAccess(executor, userId, workspaceId);
    if (access) {
      return access;
    }

    const deletedMembership = await executor.query(
      `SELECT 1
       FROM workspace_members members
       INNER JOIN editor_workspaces workspaces
         ON workspaces.id = members.workspace_id
       WHERE members.user_id = $1
         AND members.workspace_id = $2
         AND workspaces.deleted_at IS NOT NULL
       LIMIT 1`,
      [userId, workspaceId],
    );
    if (deletedMembership.rows.length > 0) {
      throw new WorkspaceDomainError("workspace_deleted", "Workspace has been deleted");
    }

    throw new WorkspaceNotFoundError();
  }
}

function toWorkspaceSummary(row: Record<string, unknown>): WorkspaceSummary {
  return {
    createdAt: Number(row.created_at),
    id: String(row.id),
    name: String(row.name),
    role: row.role as WorkspaceRole,
    updatedAt: Number(row.updated_at),
  };
}
