import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  Block,
  BlockComment,
  EditorDocument,
  EditorWorkspace,
} from "../features/editor/model/block";
import { createDefaultWorkspace } from "../features/editor/model/workspaceOperations";

export type WorkspaceRole = "owner" | "editor" | "viewer";
export type AssignableWorkspaceRole = Exclude<WorkspaceRole, "owner">;

export interface WorkspaceMember {
  id: string;
  displayName: string;
  email: string;
  role: WorkspaceRole;
}

export interface LoadedWorkspace {
  role: WorkspaceRole;
  workspace: EditorWorkspace;
  workspaceId: string;
}

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

export class WorkspaceMemberNotFoundError extends Error {
  constructor() {
    super("该邮箱尚未创建用户身份");
    this.name = "WorkspaceMemberNotFoundError";
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
    const existingAccess = await this.findAccess(executor, userId);

    if (existingAccess) {
      await this.ensureDefaultDocument(executor, existingAccess.workspaceId);
      return existingAccess.workspaceId;
    }

    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const access = await this.findAccess(client, userId);
      if (access) {
        await client.query("COMMIT");
        await this.ensureDefaultDocument(client, access.workspaceId);
        return access.workspaceId;
      }

      const workspaceId = this.idFactory();
      const now = this.now();

      await client.query(
        `INSERT INTO editor_workspaces (id, name, owner_id, active_document_id, updated_at, created_at)
         VALUES ($1, $2, $3, NULL, $4, $4)`,
        [workspaceId, name.trim() || "我的工作区", userId, now],
      );
      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
         VALUES ($1, $2, 'owner', $3)`,
        [workspaceId, userId, now],
      );
      await client.query(
        `INSERT INTO workspace_preferences (user_id, workspace_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id`,
        [userId, workspaceId],
      );
      await client.query("COMMIT");

      await this.ensureDefaultDocument(client, workspaceId);

      return workspaceId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async loadWorkspace(userId: string): Promise<LoadedWorkspace | null> {
    const access = await this.findAccess(this.pool, userId);

    if (!access) {
      return null;
    }

    const workspaceResult = await this.pool.query(
      "SELECT active_document_id, updated_at FROM editor_workspaces WHERE id = $1",
      [access.workspaceId],
    );
    const workspaceRow = workspaceResult.rows[0];

    if (!workspaceRow?.active_document_id) {
      return null;
    }

    const documentResult = await this.pool.query(
      `SELECT id, title, template_id, pinned, updated_at
       FROM editor_documents
       WHERE workspace_id = $1
       ORDER BY position ASC`,
      [access.workspaceId],
    );
    if (documentResult.rows.length === 0) {
      return null;
    }

    const blockResult = await this.pool.query(
      `SELECT blocks.id, blocks.document_id, blocks.type, blocks.content, blocks.data, blocks.checked,
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

    return {
      role: access.role,
      workspace: {
        activeDocumentId: String(workspaceRow.active_document_id),
        documents,
        updatedAt: Number(workspaceRow.updated_at),
      },
      workspaceId: access.workspaceId,
    };
  }

  async saveWorkspace(userId: string, workspace: EditorWorkspace) {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const access = await this.findAccess(client, userId);

      if (!access || access.role === "viewer") {
        throw new WorkspacePermissionError();
      }

      await client.query(
        "UPDATE editor_workspaces SET active_document_id = $1, updated_at = $2 WHERE id = $3",
        [workspace.activeDocumentId, workspace.updatedAt, access.workspaceId],
      );
      await client.query(
        "DELETE FROM editor_documents WHERE workspace_id = $1",
        [access.workspaceId],
      );

      for (const [
        documentPosition,
        document,
      ] of workspace.documents.entries()) {
        await this.insertDocument(
          client,
          access.workspaceId,
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

      await client.query("COMMIT");
      return workspace;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async addMember(
    ownerUserId: string,
    email: string,
    role: AssignableWorkspaceRole,
  ) {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      const access = await this.findAccess(client, ownerUserId);

      if (!access || access.role !== "owner") {
        await client.query("ROLLBACK");
        throw new WorkspacePermissionError("只有工作区所有者可以管理成员");
      }

      const userResult = await client.query(
        "SELECT id FROM app_users WHERE email = $1",
        [email.trim().toLowerCase()],
      );
      const userId = userResult.rows[0]?.id;

      if (!userId) {
        await client.query("ROLLBACK");
        throw new WorkspaceMemberNotFoundError();
      }

      await client.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [access.workspaceId, String(userId), role, this.now()],
      );
      await client.query(
        `INSERT INTO workspace_preferences (user_id, workspace_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET workspace_id = EXCLUDED.workspace_id`,
        [String(userId), access.workspaceId],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listMembers(userId: string): Promise<WorkspaceMember[]> {
    const access = await this.findAccess(this.pool, userId);

    if (!access) {
      throw new WorkspacePermissionError("没有查看此工作区成员的权限");
    }

    const result = await this.pool.query(
      `SELECT users.id, users.email, users.display_name, members.role
       FROM workspace_members members
       INNER JOIN app_users users ON users.id = members.user_id
       WHERE members.workspace_id = $1
       ORDER BY CASE members.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,
                users.created_at ASC`,
      [access.workspaceId],
    );

    return result.rows.map((row) => ({
      displayName: String(row.display_name),
      email: String(row.email),
      id: String(row.id),
      role: row.role as WorkspaceRole,
    }));
  }

  async getWorkspaceAccess(userId: string) {
    return this.findAccess(this.pool, userId);
  }

  async getDocumentAccess(
    userId: string,
    documentId: string,
  ): Promise<WorkspaceAccess | null> {
    const result = await this.pool.query(
      `SELECT members.workspace_id, members.role
       FROM workspace_preferences preferences
       INNER JOIN workspace_members members
         ON members.workspace_id = preferences.workspace_id AND members.user_id = preferences.user_id
       INNER JOIN editor_documents documents ON documents.workspace_id = preferences.workspace_id
       WHERE preferences.user_id = $1 AND documents.id = $2
       LIMIT 1`,
      [userId, documentId],
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
    documentId: string,
  ): Promise<DocumentVersionSummary[]> {
    const access = await this.findAccess(this.pool, userId);

    if (!access) {
      throw new WorkspacePermissionError("没有查看此文档历史的权限");
    }

    const result = await this.pool.query(
      `SELECT versions.id, versions.document_id, versions.title, versions.created_at,
              users.display_name AS created_by_name
       FROM document_versions versions
       LEFT JOIN app_users users ON users.id = versions.created_by
       WHERE versions.workspace_id = $1 AND versions.document_id = $2
       ORDER BY versions.created_at DESC, versions.id DESC`,
      [access.workspaceId, documentId],
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
    documentId: string,
    versionId: string,
  ) {
    const access = await this.findAccess(this.pool, userId);

    if (!access || access.role === "viewer") {
      throw new WorkspacePermissionError("没有恢复此文档版本的权限");
    }

    const versionResult = await this.pool.query(
      `SELECT snapshot
       FROM document_versions
       WHERE workspace_id = $1 AND document_id = $2 AND id = $3`,
      [access.workspaceId, documentId, versionId],
    );
    const snapshot = versionResult.rows[0]?.snapshot;

    if (!snapshot || typeof snapshot !== "object") {
      throw new Error("文档版本不存在");
    }

    const loaded = await this.loadWorkspace(userId);
    if (!loaded) {
      throw new Error("工作区不存在");
    }

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
      ...loaded.workspace,
      documents: loaded.workspace.documents.map((document) =>
        document.id === documentId ? nextDocument : document,
      ),
      updatedAt: now,
    };

    await this.saveWorkspace(userId, nextWorkspace);
    return nextDocument;
  }

  private async insertDocument(
    client: Pick<PoolClient, "query">,
    workspaceId: string,
    document: EditorDocument,
    position: number,
  ) {
    await client.query(
      `INSERT INTO editor_documents
       (id, workspace_id, title, template_id, pinned, position, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        document.id,
        workspaceId,
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
         (workspace_id, id, document_id, type, content, data, checked, assignee, due_date, status,
          parent_id, position, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          workspaceId,
          block.id,
          document.id,
          block.type,
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
    workspaceId: string,
  ) {
    const workspace = createDefaultWorkspace(this.now());
    const claimed = await executor.query(
      `UPDATE editor_workspaces
       SET active_document_id = $1, updated_at = $2
       WHERE id = $3 AND active_document_id IS NULL
       RETURNING id`,
      [workspace.activeDocumentId, workspace.updatedAt, workspaceId],
    );

    if (claimed.rowCount === 0) {
      return;
    }

    await this.insertDocument(executor, workspaceId, workspace.documents[0], 0);
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
  ) {
    const result = await executor.query(
      `SELECT members.workspace_id, members.role
       FROM workspace_members members
       INNER JOIN editor_workspaces workspaces ON workspaces.id = members.workspace_id
       LEFT JOIN workspace_preferences preferences ON preferences.user_id = members.user_id
       WHERE members.user_id = $1
       ORDER BY CASE WHEN preferences.workspace_id = members.workspace_id THEN 0 ELSE 1 END,
                workspaces.created_at ASC
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
}
