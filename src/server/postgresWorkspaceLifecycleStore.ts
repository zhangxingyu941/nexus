import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  DeletedWorkspaceSummary,
  WorkspaceDeletionSummary,
} from "../shared/workspaceLifecycle";
import { WorkspaceAuditStore } from "./workspaceAuditStore";
import { WorkspaceDomainError } from "./workspaceErrors";
import {
  notifyWorkspaceAccessInvalidation,
  type WorkspaceAccessInvalidation,
} from "./workspaceAccessNotifications";

const PURGE_DELAY_MS = 7 * 24 * 60 * 60_000;

type WorkspaceAccessNotifier = (
  client: Pick<PoolClient, "query">,
  event: WorkspaceAccessInvalidation,
) => Promise<unknown>;

interface PostgresWorkspaceLifecycleStoreOptions {
  auditEventIdFactory?: () => string;
  now?: () => number;
  notifyAccessInvalidation?: WorkspaceAccessNotifier;
}

interface OwnedWorkspace {
  actorDisplayName: string;
  id: string;
  name: string;
}

export interface ExpiredWorkspacePurgeCandidate {
  id: string;
  name: string;
}

export interface WorkspacePurgeClaim {
  candidate: ExpiredWorkspacePurgeCandidate;
  purgeDatabaseRow: () => Promise<boolean>;
  release: () => Promise<void>;
}

export class PostgresWorkspaceLifecycleStore {
  private readonly auditStore: WorkspaceAuditStore;
  private readonly now: () => number;
  private readonly notifyAccessInvalidation: WorkspaceAccessNotifier;

  constructor(
    private readonly pool: Pool,
    options: PostgresWorkspaceLifecycleStoreOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.auditStore = new WorkspaceAuditStore(
      options.auditEventIdFactory ?? (() => `workspace-audit-${randomUUID()}`),
      this.now,
    );
    this.notifyAccessInvalidation = options.notifyAccessInvalidation
      ?? notifyWorkspaceAccessInvalidation;
  }

  async getDeletionSummary(
    actorUserId: string,
    workspaceId: string,
  ): Promise<WorkspaceDeletionSummary> {
    const workspace = await this.requireOwner(this.pool, actorUserId, workspaceId);
    const [documents, files, members] = await Promise.all([
      this.pool.query(
        "SELECT COUNT(*)::int AS count FROM editor_documents WHERE workspace_id = $1",
        [workspace.id],
      ),
      this.pool.query(
        `SELECT COUNT(*)::int AS count
         FROM editor_blocks
         WHERE workspace_id = $1 AND type IN ('image', 'file')`,
        [workspace.id],
      ),
      this.pool.query(
        "SELECT COUNT(*)::int AS count FROM workspace_members WHERE workspace_id = $1",
        [workspace.id],
      ),
    ]);

    return {
      documentCount: Number(documents.rows[0]?.count ?? 0),
      fileCount: Number(files.rows[0]?.count ?? 0),
      id: workspace.id,
      memberCount: Number(members.rows[0]?.count ?? 0),
      name: workspace.name,
    };
  }

  async deleteWorkspace(input: {
    actorUserId: string;
    confirmationName: string;
    workspaceId: string;
  }): Promise<DeletedWorkspaceSummary> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const workspace = await this.requireOwner(client, input.actorUserId, input.workspaceId, true);
      if (input.confirmationName !== workspace.name) {
        throw new WorkspaceDomainError(
          "workspace_name_confirmation_mismatch",
          "Workspace name confirmation does not match",
        );
      }

      const deletedAt = this.now();
      const purgeAfter = deletedAt + PURGE_DELAY_MS;
      await client.query(
        `UPDATE editor_workspaces
         SET deleted_at = $1, deleted_by = $2, purge_after = $3
         WHERE id = $4`,
        [deletedAt, input.actorUserId, purgeAfter, workspace.id],
      );
      await this.auditStore.write(client, {
        actorUserId: input.actorUserId,
        eventType: "workspace_deleted",
        metadata: { deletedAt, purgeAfter },
        targetId: workspace.id,
        targetType: "workspace",
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      });

      const revokedInvites = await client.query(
        `UPDATE workspace_invites
         SET status = 'revoked', revoked_at = $1, updated_at = $1
         WHERE workspace_id = $2 AND status = 'pending'
         RETURNING id`,
        [deletedAt, workspace.id],
      );
      for (const invite of revokedInvites.rows) {
        await this.auditStore.write(client, {
          actorUserId: input.actorUserId,
          eventType: "workspace_invite_revoked",
          metadata: { status: "revoked" },
          targetId: String(invite.id),
          targetType: "workspace_invite",
          workspaceId: workspace.id,
          workspaceName: workspace.name,
        });
      }
      await this.notifyAccessInvalidation(client, {
        userId: null,
        workspaceId: workspace.id,
      });
      await client.query("COMMIT");

      return {
        deletedAt,
        deletedBy: {
          displayName: workspace.actorDisplayName,
          id: input.actorUserId,
        },
        id: workspace.id,
        name: workspace.name,
        purgeAfter,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listTrash(actorUserId: string): Promise<DeletedWorkspaceSummary[]> {
    const result = await this.pool.query(
      `SELECT workspaces.id, workspaces.name, workspaces.deleted_at, workspaces.purge_after,
              deleted_by.id AS deleted_by_id, deleted_by.display_name AS deleted_by_display_name
       FROM editor_workspaces workspaces
       INNER JOIN workspace_members members ON members.workspace_id = workspaces.id
       LEFT JOIN app_users deleted_by ON deleted_by.id = workspaces.deleted_by
       WHERE members.user_id = $1
         AND members.role = 'owner'
         AND workspaces.deleted_at IS NOT NULL
         AND workspaces.purge_after > $2
       ORDER BY workspaces.deleted_at DESC, workspaces.id ASC`,
      [actorUserId, this.now()],
    );

    return result.rows.map((row) => ({
      deletedAt: Number(row.deleted_at),
      deletedBy: row.deleted_by_id
        ? {
            displayName: String(row.deleted_by_display_name),
            id: String(row.deleted_by_id),
          }
        : null,
      id: String(row.id),
      name: String(row.name),
      purgeAfter: Number(row.purge_after),
    }));
  }

  async restoreWorkspace(actorUserId: string, workspaceId: string): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const workspaceResult = await client.query(
        `SELECT id, name, deleted_at, purge_after
         FROM editor_workspaces
         WHERE id = $1
         FOR UPDATE`,
        [workspaceId],
      );
      const workspace = workspaceResult.rows[0];
      if (!workspace || workspace.deleted_at === null || workspace.deleted_at === undefined) {
        throw new WorkspaceDomainError("workspace_not_found", "Workspace not found");
      }

      const membershipResult = await client.query(
        `SELECT role
         FROM workspace_members
         WHERE workspace_id = $1 AND user_id = $2
         LIMIT 1`,
        [workspaceId, actorUserId],
      );
      const membership = membershipResult.rows[0];
      if (!membership) {
        throw new WorkspaceDomainError("workspace_not_found", "Workspace not found");
      }
      if (membership.role !== "owner") {
        throw new WorkspaceDomainError(
          "workspace_forbidden",
          "Only workspace owners can restore a workspace",
        );
      }
      if (workspace.purge_after === null
        || workspace.purge_after === undefined
        || this.now() >= Number(workspace.purge_after)) {
        throw new WorkspaceDomainError(
          "workspace_purge_expired",
          "Workspace can no longer be restored",
        );
      }

      await client.query(
        `UPDATE editor_workspaces
         SET deleted_at = NULL, deleted_by = NULL, purge_after = NULL
         WHERE id = $1`,
        [workspaceId],
      );
      await this.auditStore.write(client, {
        actorUserId,
        eventType: "workspace_restored",
        metadata: {},
        targetId: String(workspace.id),
        targetType: "workspace",
        workspaceId: String(workspace.id),
        workspaceName: String(workspace.name),
      });
      await client.query(
        `INSERT INTO workspace_preferences (user_id, selected_workspace_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
         SET selected_workspace_id = EXCLUDED.selected_workspace_id`,
        [actorUserId, workspaceId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listExpiredPurgeCandidates(limit: number): Promise<ExpiredWorkspacePurgeCandidate[]> {
    const result = await this.pool.query(
      `SELECT id, name
       FROM editor_workspaces
       WHERE deleted_at IS NOT NULL AND purge_after <= $1
       ORDER BY purge_after ASC, id ASC
       LIMIT $2`,
      [this.now(), limit],
    );

    return result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
    }));
  }

  async claimExpiredWorkspace(workspaceId: string): Promise<WorkspacePurgeClaim | null> {
    const client = await this.pool.connect();
    const lockName = `workspace-purge:${workspaceId}`;
    let advisoryLockHeld = false;
    let transactionOpen = false;

    try {
      const lockResult = await client.query(
        "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
        [lockName],
      );
      if (!lockResult.rows[0]?.locked) {
        client.release();
        return null;
      }
      advisoryLockHeld = true;

      await client.query("BEGIN");
      transactionOpen = true;
      const candidateResult = await client.query(
        `SELECT id, name
         FROM editor_workspaces
         WHERE id = $1 AND deleted_at IS NOT NULL AND purge_after <= $2
         FOR UPDATE`,
        [workspaceId, this.now()],
      );
      const candidate = candidateResult.rows[0];
      if (!candidate) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
        advisoryLockHeld = false;
        client.release();
        return null;
      }

      let released = false;
      let databaseRowPurged = false;
      const release = async () => {
        if (released) return;
        released = true;

        try {
          if (transactionOpen) {
            await client.query("ROLLBACK");
            transactionOpen = false;
          }
        } finally {
          try {
            if (advisoryLockHeld) {
              await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
              advisoryLockHeld = false;
            }
          } finally {
            client.release();
          }
        }
      };

      return {
        candidate: {
          id: String(candidate.id),
          name: String(candidate.name),
        },
        purgeDatabaseRow: async () => {
          if (released || databaseRowPurged) return false;

          const recheck = await client.query(
            `SELECT id, name
             FROM editor_workspaces
             WHERE id = $1 AND deleted_at IS NOT NULL AND purge_after <= $2
             FOR UPDATE`,
            [workspaceId, this.now()],
          );
          const stillExpired = recheck.rows[0];
          if (!stillExpired) {
            return false;
          }

          await this.auditStore.write(client, {
            actorUserId: null,
            eventType: "workspace_purged",
            metadata: { purgedAt: this.now() },
            targetId: String(stillExpired.id),
            targetType: "workspace",
            workspaceId: String(stillExpired.id),
            workspaceName: String(stillExpired.name),
          });
          const deleted = await client.query(
            "DELETE FROM editor_workspaces WHERE id = $1",
            [workspaceId],
          );
          await client.query("COMMIT");
          transactionOpen = false;
          databaseRowPurged = true;
          return deleted.rowCount === 1;
        },
        release,
      };
    } catch (error) {
      try {
        if (transactionOpen) {
          await client.query("ROLLBACK");
        }
      } finally {
        try {
          if (advisoryLockHeld) {
            await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
          }
        } finally {
          client.release();
        }
      }
      throw error;
    }
  }

  private async requireOwner(
    executor: Pick<Pool, "query"> | Pick<PoolClient, "query">,
    actorUserId: string,
    workspaceId: string,
    lock = false,
  ): Promise<OwnedWorkspace> {
    const workspaceResult = await executor.query(
      `SELECT id, name, deleted_at
       FROM editor_workspaces
       WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
      [workspaceId],
    );
    const workspace = workspaceResult.rows[0];
    if (!workspace) {
      throw new WorkspaceDomainError("workspace_not_found", "Workspace not found");
    }

    const membershipResult = await executor.query(
      `SELECT members.role, users.display_name
       FROM workspace_members members
       INNER JOIN app_users users ON users.id = members.user_id
       WHERE members.workspace_id = $1 AND members.user_id = $2
       LIMIT 1`,
      [workspaceId, actorUserId],
    );
    const membership = membershipResult.rows[0];
    if (!membership) {
      throw new WorkspaceDomainError("workspace_not_found", "Workspace not found");
    }
    if (workspace.deleted_at !== null && workspace.deleted_at !== undefined) {
      throw new WorkspaceDomainError("workspace_deleted", "Workspace has been deleted");
    }
    if (membership.role !== "owner") {
      throw new WorkspaceDomainError(
        "workspace_forbidden",
        "Only workspace owners can delete a workspace",
      );
    }

    return {
      actorDisplayName: String(membership.display_name),
      id: String(workspace.id),
      name: String(workspace.name),
    };
  }
}
