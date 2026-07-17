import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { WorkspaceRole } from "../shared/workspace";
import type { WorkspaceMemberSummary } from "../shared/workspaceMembers";
import { WorkspaceAuditStore } from "./workspaceAuditStore";
import { WorkspaceDomainError } from "./workspaceErrors";

interface PostgresWorkspaceMemberStoreOptions {
  auditEventIdFactory?: () => string;
  now?: () => number;
}

export class PostgresWorkspaceMemberStore {
  private readonly auditStore: WorkspaceAuditStore;

  constructor(
    private readonly pool: Pool,
    options: PostgresWorkspaceMemberStoreOptions = {},
  ) {
    this.auditStore = new WorkspaceAuditStore(
      options.auditEventIdFactory ?? (() => `workspace-audit-${randomUUID()}`),
      options.now ?? Date.now,
    );
  }

  async listMembers(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceMemberSummary[]> {
    const access = await this.pool.query(
      `SELECT workspaces.id
       FROM editor_workspaces workspaces
       INNER JOIN workspace_members members ON members.workspace_id = workspaces.id
       WHERE workspaces.id = $1 AND members.user_id = $2
       LIMIT 1`,
      [workspaceId, userId],
    );
    if (!access.rows[0]) {
      throw new WorkspaceDomainError("workspace_not_found", "Workspace not found");
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
      await this.requireOwner(client, input.actorUserId, workspace.id);
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
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockWorkspace(client: PoolClient, workspaceId: string) {
    const result = await client.query(
      `SELECT id, name
       FROM editor_workspaces
       WHERE id = $1
       FOR UPDATE`,
      [workspaceId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new WorkspaceDomainError("workspace_not_found", "Workspace not found");
    }
    return { id: String(row.id), name: String(row.name) };
  }

  private async requireOwner(
    client: PoolClient,
    actorUserId: string,
    workspaceId: string,
  ) {
    const result = await client.query(
      `SELECT role
       FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2
       LIMIT 1`,
      [workspaceId, actorUserId],
    );
    if (result.rows[0]?.role !== "owner") {
      throw new WorkspaceDomainError(
        "workspace_forbidden",
        "Only workspace owners can manage members",
      );
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
