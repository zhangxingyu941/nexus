import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { WorkspaceRole } from "../shared/workspace";
import type { WorkspaceMemberSummary } from "../shared/workspaceMembers";
import { PostgresWorkspaceStore } from "./postgresWorkspaceStore";
import { WorkspaceAuditStore } from "./workspaceAuditStore";
import {
  notifyWorkspaceAccessInvalidation,
  type WorkspaceAccessInvalidation,
} from "./workspaceAccessNotifications";
import { WorkspaceDomainError } from "./workspaceErrors";

type WorkspaceAccessNotifier = (
  client: Pick<PoolClient, "query">,
  event: WorkspaceAccessInvalidation,
) => Promise<unknown>;

interface PostgresWorkspaceMemberStoreOptions {
  auditEventIdFactory?: () => string;
  now?: () => number;
  notifyAccessInvalidation?: WorkspaceAccessNotifier;
}

export class PostgresWorkspaceMemberStore {
  private readonly auditStore: WorkspaceAuditStore;
  private readonly notifyAccessInvalidation: WorkspaceAccessNotifier;
  private readonly workspaceStore: PostgresWorkspaceStore;

  constructor(
    private readonly pool: Pool,
    options: PostgresWorkspaceMemberStoreOptions = {},
  ) {
    const now = options.now ?? Date.now;
    this.auditStore = new WorkspaceAuditStore(
      options.auditEventIdFactory ?? (() => `workspace-audit-${randomUUID()}`),
      now,
    );
    this.notifyAccessInvalidation = options.notifyAccessInvalidation
      ?? notifyWorkspaceAccessInvalidation;
    this.workspaceStore = new PostgresWorkspaceStore(pool, { now });
  }

  async listMembers(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceMemberSummary[]> {
    const access = await this.pool.query(
      `SELECT workspaces.id, workspaces.deleted_at
       FROM editor_workspaces workspaces
       INNER JOIN workspace_members members ON members.workspace_id = workspaces.id
       WHERE workspaces.id = $1 AND members.user_id = $2
       LIMIT 1`,
      [workspaceId, userId],
    );
    if (!access.rows[0]) {
      throw new WorkspaceDomainError("workspace_not_found", "Workspace not found");
    }
    if (access.rows[0].deleted_at !== null && access.rows[0].deleted_at !== undefined) {
      throw new WorkspaceDomainError("workspace_deleted", "Workspace has been deleted");
    }

    const result = await this.pool.query(
      `SELECT users.id, users.email, users.display_name, members.role, members.created_at
       FROM workspace_members members
       INNER JOIN app_users users ON users.id = members.user_id
       WHERE members.workspace_id = $1
       ORDER BY CASE members.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,
                members.created_at ASC,
                users.id ASC`,
      [workspaceId],
    );

    return result.rows.map((row) => ({
      displayName: String(row.display_name),
      email: String(row.email),
      id: String(row.id),
      joinedAt: Number(row.created_at),
      role: row.role as WorkspaceRole,
    }));
  }

  async updateRole(input: {
    actorUserId: string;
    memberId: string;
    role: WorkspaceRole;
    workspaceId: string;
  }): Promise<void> {
    const role = validateRole(input.role);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const workspace = await this.lockWorkspace(client, input.workspaceId);
      await this.requireOwner(client, input.actorUserId, workspace);
      const targetRole = await this.requireMember(client, input.memberId, workspace.id);

      if (targetRole === role) {
        await client.query("COMMIT");
        return;
      }

      if (targetRole === "owner" && role !== "owner") {
        const ownerCount = await client.query(
          `SELECT COUNT(*)::int AS count
           FROM workspace_members
           WHERE workspace_id = $1 AND role = 'owner'`,
          [workspace.id],
        );
        if (Number(ownerCount.rows[0]?.count) <= 1) {
          throw new WorkspaceDomainError(
            "last_owner_protected",
            "A workspace must retain at least one owner",
          );
        }
      }

      await client.query(
        `UPDATE workspace_members
         SET role = $1
         WHERE workspace_id = $2 AND user_id = $3`,
        [role, workspace.id, input.memberId],
      );
      await this.auditStore.write(client, {
        actorUserId: input.actorUserId,
        eventType: "workspace_member_role_changed",
        metadata: { previousRole: targetRole, role },
        targetId: input.memberId,
        targetType: "workspace_member",
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      });
      await this.notifyAccessInvalidation(client, {
        userId: input.memberId,
        workspaceId: workspace.id,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async removeMember(input: {
    actorUserId: string;
    memberId: string;
    workspaceId: string;
  }): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const workspace = await this.lockWorkspace(client, input.workspaceId);
      await this.requireOwner(client, input.actorUserId, workspace);
      if (input.actorUserId === input.memberId) {
        throw new WorkspaceDomainError(
          "member_self_remove_forbidden",
          "Owners must leave a workspace through the leave operation",
        );
      }
      const targetRole = await this.requireMember(client, input.memberId, workspace.id);
      await this.protectLastOwner(client, workspace.id, targetRole);
      const displayName = await this.loadUserDisplayName(client, input.memberId);

      await this.removeMembership(client, {
        actorUserId: input.actorUserId,
        displayName,
        eventType: "workspace_member_removed",
        role: targetRole,
        userId: input.memberId,
        workspace,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async transferOwnership(input: {
    actorUserId: string;
    retainOwnerRole: boolean;
    targetUserId: string;
    workspaceId: string;
  }): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const workspace = await this.lockWorkspace(client, input.workspaceId);
      await this.requireOwner(client, input.actorUserId, workspace);
      const targetRole = await this.requireTransferTarget(
        client,
        input.targetUserId,
        workspace.id,
      );

      await client.query(
        `UPDATE workspace_members
         SET role = 'owner'
         WHERE workspace_id = $1 AND user_id = $2`,
        [workspace.id, input.targetUserId],
      );
      if (!input.retainOwnerRole) {
        await client.query(
          `UPDATE workspace_members
           SET role = 'editor'
           WHERE workspace_id = $1 AND user_id = $2`,
          [workspace.id, input.actorUserId],
        );
      }
      await this.auditStore.write(client, {
        actorUserId: input.actorUserId,
        eventType: "workspace_ownership_transferred",
        metadata: {
          previousRole: targetRole,
          retainOwnerRole: input.retainOwnerRole,
        },
        targetId: input.targetUserId,
        targetType: "workspace_member",
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      });
      await this.notifyAccessInvalidation(client, {
        userId: input.targetUserId,
        workspaceId: workspace.id,
      });
      if (!input.retainOwnerRole) {
        await this.notifyAccessInvalidation(client, {
          userId: input.actorUserId,
          workspaceId: workspace.id,
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

  async leaveWorkspace(input: {
    userId: string;
    userDisplayName: string;
    workspaceId: string;
  }): Promise<{ selectedWorkspaceId: string }> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const workspace = await this.lockWorkspace(client, input.workspaceId);
      const role = await this.requireMember(client, input.userId, workspace.id);
      this.requireActiveWorkspace(workspace);
      await this.protectLastOwner(client, workspace.id, role);
      const selectedWorkspaceId = await this.removeMembership(client, {
        actorUserId: input.userId,
        displayName: input.userDisplayName,
        eventType: "workspace_member_left",
        role,
        userId: input.userId,
        workspace,
      });
      await client.query("COMMIT");
      return { selectedWorkspaceId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async removeMembership(
    client: PoolClient,
    input: {
      actorUserId: string;
      displayName: string;
      eventType: "workspace_member_left" | "workspace_member_removed";
      role: WorkspaceRole;
      userId: string;
      workspace: { id: string; name: string };
    },
  ) {
    await client.query(
      `SELECT id
       FROM app_users
       WHERE id = $1
       FOR UPDATE`,
      [input.userId],
    );
    const preference = await client.query(
      `SELECT selected_workspace_id
       FROM workspace_preferences
       WHERE user_id = $1
       FOR UPDATE`,
      [input.userId],
    );
    const currentWorkspaceId = preference.rows[0]?.selected_workspace_id
      ? String(preference.rows[0].selected_workspace_id)
      : null;

    await client.query(
      `DELETE FROM workspace_document_preferences
       WHERE workspace_id = $1 AND user_id = $2`,
      [input.workspace.id, input.userId],
    );
    await client.query(
      `DELETE FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2`,
      [input.workspace.id, input.userId],
    );
    await this.auditStore.write(client, {
      actorUserId: input.actorUserId,
      eventType: input.eventType,
      metadata: { previousRole: input.role },
      targetId: input.userId,
      targetType: "workspace_member",
      workspaceId: input.workspace.id,
      workspaceName: input.workspace.name,
    });
    await this.notifyAccessInvalidation(client, {
      userId: input.userId,
      workspaceId: input.workspace.id,
    });

    const remaining = await client.query(
      `SELECT workspaces.id
       FROM workspace_members members
       INNER JOIN editor_workspaces workspaces ON workspaces.id = members.workspace_id
       WHERE members.user_id = $1 AND workspaces.deleted_at IS NULL
       ORDER BY workspaces.created_at ASC, workspaces.id ASC`,
      [input.userId],
    );
    const selectedWorkspaceId = remaining.rows.some(
      (row) => String(row.id) === currentWorkspaceId,
    )
      ? currentWorkspaceId
      : remaining.rows[0]?.id
        ? String(remaining.rows[0].id)
        : null;

    if (selectedWorkspaceId) {
      await client.query(
        `INSERT INTO workspace_preferences (user_id, selected_workspace_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE
         SET selected_workspace_id = EXCLUDED.selected_workspace_id`,
        [input.userId, selectedWorkspaceId],
      );
      return selectedWorkspaceId;
    }

    return this.workspaceStore.ensurePersonalWorkspace(
      input.userId,
      `${input.displayName}的工作区`,
      client,
    );
  }

  private async lockWorkspace(client: PoolClient, workspaceId: string) {
    const result = await client.query(
      `SELECT id, name, deleted_at
       FROM editor_workspaces
       WHERE id = $1
       FOR UPDATE`,
      [workspaceId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new WorkspaceDomainError("workspace_not_found", "Workspace not found");
    }
    return {
      deletedAt: row.deleted_at === null || row.deleted_at === undefined
        ? null
        : Number(row.deleted_at),
      id: String(row.id),
      name: String(row.name),
    };
  }

  private async requireOwner(
    client: PoolClient,
    actorUserId: string,
    workspace: { deletedAt: number | null; id: string },
  ) {
    const result = await client.query(
      `SELECT role
       FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2
       LIMIT 1`,
      [workspace.id, actorUserId],
    );
    const role = result.rows[0]?.role;
    if (!role) {
      throw new WorkspaceDomainError(
        "workspace_forbidden",
        "Only workspace owners can manage members",
      );
    }
    this.requireActiveWorkspace(workspace);
    if (role !== "owner") {
      throw new WorkspaceDomainError(
        "workspace_forbidden",
        "Only workspace owners can manage members",
      );
    }
  }

  private requireActiveWorkspace(workspace: { deletedAt: number | null }) {
    if (workspace.deletedAt !== null) {
      throw new WorkspaceDomainError("workspace_deleted", "Workspace has been deleted");
    }
  }

  private async requireMember(
    client: PoolClient,
    memberId: string,
    workspaceId: string,
  ): Promise<WorkspaceRole> {
    const result = await client.query(
      `SELECT role
       FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2
       LIMIT 1`,
      [workspaceId, memberId],
    );
    const role = result.rows[0]?.role;
    if (!role) {
      throw new WorkspaceDomainError("member_not_found", "Workspace member not found");
    }
    return role as WorkspaceRole;
  }

  private async requireTransferTarget(
    client: PoolClient,
    targetUserId: string,
    workspaceId: string,
  ): Promise<Exclude<WorkspaceRole, "owner">> {
    const result = await client.query(
      `SELECT role
       FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2
       LIMIT 1`,
      [workspaceId, targetUserId],
    );
    const role = result.rows[0]?.role;
    if (role !== "editor" && role !== "viewer") {
      throw new WorkspaceDomainError(
        "ownership_target_invalid",
        "Ownership can only be transferred to a non-owner workspace member",
      );
    }
    return role;
  }

  private async protectLastOwner(
    client: PoolClient,
    workspaceId: string,
    role: WorkspaceRole,
  ) {
    if (role !== "owner") {
      return;
    }
    const ownerCount = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM workspace_members
       WHERE workspace_id = $1 AND role = 'owner'`,
      [workspaceId],
    );
    if (Number(ownerCount.rows[0]?.count) <= 1) {
      throw new WorkspaceDomainError(
        "last_owner_protected",
        "A workspace must retain at least one owner",
      );
    }
  }

  private async loadUserDisplayName(client: PoolClient, userId: string) {
    const result = await client.query(
      "SELECT display_name FROM app_users WHERE id = $1",
      [userId],
    );
    return String(result.rows[0]?.display_name ?? "");
  }
}

function validateRole(role: WorkspaceRole) {
  if (role !== "owner" && role !== "editor" && role !== "viewer") {
    throw new WorkspaceDomainError(
      "member_role_invalid",
      "Workspace member role must be owner, editor, or viewer",
    );
  }
  return role;
}
