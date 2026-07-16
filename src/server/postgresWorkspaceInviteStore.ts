import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  ReceivedWorkspaceInvite,
  WorkspaceInviteRole,
  WorkspaceInviteSummary,
} from "../shared/workspaceInvites";
import { WorkspaceAuditStore } from "./workspaceAuditStore";
import { WorkspaceDomainError } from "./workspaceErrors";
import { WorkspaceInviteTokenService } from "./workspaceInviteTokens";

const INVITE_DURATION_MS = 24 * 60 * 60_000;
const TERMINAL_HISTORY_DURATION_MS = 30 * 24 * 60 * 60_000;

interface PostgresWorkspaceInviteStoreOptions {
  auditEventIdFactory?: () => string;
  idFactory?: () => string;
  now?: () => number;
  tokenService: WorkspaceInviteTokenService;
}

interface LockedWorkspace {
  id: string;
  name: string;
}

interface OwnerAccess {
  displayName: string;
}

export class PostgresWorkspaceInviteStore {
  private readonly auditStore: WorkspaceAuditStore;
  private readonly idFactory: () => string;
  private readonly now: () => number;
  private readonly tokenService: WorkspaceInviteTokenService;

  constructor(
    private readonly pool: Pool,
    options: PostgresWorkspaceInviteStoreOptions,
  ) {
    this.idFactory = options.idFactory ?? (() => `invite-${randomUUID()}`);
    this.now = options.now ?? Date.now;
    this.tokenService = options.tokenService;
    this.auditStore = new WorkspaceAuditStore(
      options.auditEventIdFactory ?? (() => `workspace-audit-${randomUUID()}`),
      this.now,
    );
  }

  async createInvite(input: {
    actorUserId: string;
    workspaceId: string;
    email: string;
    role: WorkspaceInviteRole;
  }): Promise<{ invite: WorkspaceInviteSummary; rawToken: string }> {
    const email = normalizeEmail(input.email);
    const role = validateRole(input.role);
    const rawToken = this.tokenService.createRawToken();
    const tokenHash = this.tokenService.hashRawToken(rawToken);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const workspace = await this.lockWorkspace(client, input.workspaceId);
      const actor = await this.requireOwner(client, input.actorUserId, workspace.id);
      await this.expirePendingInvites(client, workspace);

      const member = await client.query(
        `SELECT members.user_id
         FROM workspace_members members
         INNER JOIN app_users users ON users.id = members.user_id
         WHERE members.workspace_id = $1 AND users.email = $2
         LIMIT 1`,
        [workspace.id, email],
      );
      if (member.rows[0]) {
        throw new WorkspaceDomainError("already_member", "This user is already a workspace member");
      }

      const pending = await client.query(
        `SELECT id
         FROM workspace_invites
         WHERE workspace_id = $1 AND email = $2 AND status = 'pending'
         LIMIT 1`,
        [workspace.id, email],
      );
      if (pending.rows[0]) {
        throw new WorkspaceDomainError("invite_pending", "A pending invitation already exists for this email");
      }

      const now = this.now();
      const inviteId = this.idFactory();
      const expiresAt = now + INVITE_DURATION_MS;
      await client.query(
        `INSERT INTO workspace_invites
         (id, workspace_id, email, role, token_hash, status, delivery_status, invited_by,
          created_at, updated_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', 'pending', $6, $7, $7, $8)`,
        [
          inviteId,
          workspace.id,
          email,
          role,
          tokenHash,
          input.actorUserId,
          now,
          expiresAt,
        ],
      );
      await this.auditStore.write(client, {
        actorUserId: input.actorUserId,
        eventType: "workspace_invite_created",
        metadata: { role },
        targetId: inviteId,
        targetType: "workspace_invite",
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      });
      await client.query("COMMIT");

      return {
        invite: {
          createdAt: now,
          deliveryStatus: "pending",
          email,
          expiresAt,
          id: inviteId,
          invitedBy: { displayName: actor.displayName, id: input.actorUserId },
          lastSentAt: null,
          role,
          status: "pending",
          updatedAt: now,
          workspaceId: workspace.id,
        },
        rawToken,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listOwnerInvites(
    actorUserId: string,
    workspaceId: string,
  ): Promise<WorkspaceInviteSummary[]> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const workspace = await this.lockWorkspace(client, workspaceId);
      await this.requireOwner(client, actorUserId, workspace.id);
      await this.expirePendingInvites(client, workspace);

      const result = await client.query(
        `SELECT invites.id, invites.workspace_id, invites.email, invites.role, invites.status,
                invites.delivery_status, invites.created_at, invites.updated_at, invites.expires_at,
                invites.last_sent_at, inviters.id AS invited_by_id,
                inviters.display_name AS invited_by_display_name
         FROM workspace_invites invites
         INNER JOIN app_users inviters ON inviters.id = invites.invited_by
         WHERE invites.workspace_id = $1
           AND (
             invites.status = 'pending'
             OR (
               invites.status IN ('accepted', 'declined', 'revoked', 'expired')
               AND invites.updated_at >= $2
             )
           )
         ORDER BY invites.created_at DESC, invites.id DESC`,
        [workspace.id, this.now() - TERMINAL_HISTORY_DURATION_MS],
      );
      await client.query("COMMIT");

      return result.rows.map(toWorkspaceInviteSummary);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listReceivedInvites(
    userId: string,
    emailInput: string,
  ): Promise<ReceivedWorkspaceInvite[]> {
    const email = normalizeEmail(emailInput);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const userResult = await client.query(
        "SELECT email FROM app_users WHERE id = $1 FOR UPDATE",
        [userId],
      );
      const user = userResult.rows[0];
      if (!user || String(user.email) !== email) {
        throw new WorkspaceDomainError("invite_email_mismatch", "Invitation email does not match this user");
      }

      await this.expirePendingInvitesForEmail(client, email);
      const result = await client.query(
        `SELECT invites.id, invites.workspace_id, workspaces.name AS workspace_name,
                inviters.id AS invited_by_id, inviters.display_name AS invited_by_display_name,
                invites.role, invites.email, invites.expires_at
         FROM workspace_invites invites
         INNER JOIN editor_workspaces workspaces ON workspaces.id = invites.workspace_id
         INNER JOIN app_users inviters ON inviters.id = invites.invited_by
         WHERE invites.email = $1
           AND invites.status = 'pending'
           AND invites.expires_at > $2
         ORDER BY invites.created_at DESC, invites.id DESC`,
        [email, this.now()],
      );
      await client.query("COMMIT");

      return result.rows.map((row) => ({
        expiresAt: Number(row.expires_at),
        id: String(row.id),
        invitedBy: {
          displayName: String(row.invited_by_display_name),
          id: String(row.invited_by_id),
        },
        maskedEmail: maskEmail(String(row.email)),
        role: row.role as WorkspaceInviteRole,
        workspaceId: String(row.workspace_id),
        workspaceName: String(row.workspace_name),
      }));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockWorkspace(client: PoolClient, workspaceId: string): Promise<LockedWorkspace> {
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
  ): Promise<OwnerAccess> {
    const result = await client.query(
      `SELECT members.role, users.display_name
       FROM workspace_members members
       INNER JOIN app_users users ON users.id = members.user_id
       WHERE members.workspace_id = $1 AND members.user_id = $2
       LIMIT 1`,
      [workspaceId, actorUserId],
    );
    const row = result.rows[0];
    if (!row || row.role !== "owner") {
      throw new WorkspaceDomainError("workspace_forbidden", "Only workspace owners can manage invitations");
    }
    return { displayName: String(row.display_name) };
  }

  private async expirePendingInvites(client: PoolClient, workspace: LockedWorkspace) {
    const now = this.now();
    const result = await client.query(
      `UPDATE workspace_invites
       SET status = 'expired', updated_at = $1
       WHERE workspace_id = $2
         AND status = 'pending'
         AND expires_at <= $1
       RETURNING id`,
      [now, workspace.id],
    );
    await this.writeExpiredInviteAudits(client, result.rows, workspace);
  }

  private async expirePendingInvitesForEmail(client: PoolClient, email: string) {
    const now = this.now();
    const result = await client.query(
      `UPDATE workspace_invites
       SET status = 'expired', updated_at = $1
       WHERE email = $2
         AND status = 'pending'
         AND expires_at <= $1
       RETURNING id, workspace_id`,
      [now, email],
    );
    const workspaceNames = new Map<string, string>();
    for (const row of result.rows) {
      const workspaceId = String(row.workspace_id);
      if (!workspaceNames.has(workspaceId)) {
        const workspace = await client.query(
          "SELECT name FROM editor_workspaces WHERE id = $1",
          [workspaceId],
        );
        workspaceNames.set(workspaceId, String(workspace.rows[0]?.name ?? ""));
      }
      await this.auditStore.write(client, {
        actorUserId: null,
        eventType: "workspace_invite_expired",
        metadata: { status: "expired" },
        targetId: String(row.id),
        targetType: "workspace_invite",
        workspaceId,
        workspaceName: workspaceNames.get(workspaceId) ?? "",
      });
    }
  }

  private async writeExpiredInviteAudits(
    client: PoolClient,
    invites: Array<Record<string, unknown>>,
    workspace: LockedWorkspace,
  ) {
    for (const invite of invites) {
      await this.auditStore.write(client, {
        actorUserId: null,
        eventType: "workspace_invite_expired",
        metadata: { status: "expired" },
        targetId: String(invite.id),
        targetType: "workspace_invite",
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      });
    }
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function validateRole(role: WorkspaceInviteRole) {
  if (role !== "editor" && role !== "viewer") {
    throw new WorkspaceDomainError("invite_role_invalid", "Invitation role must be editor or viewer");
  }
  return role;
}

function maskEmail(email: string) {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) {
    return "***";
  }
  return `${email.slice(0, 1)}***${email.slice(atIndex)}`;
}

function toWorkspaceInviteSummary(row: Record<string, unknown>): WorkspaceInviteSummary {
  return {
    createdAt: Number(row.created_at),
    deliveryStatus: row.delivery_status as WorkspaceInviteSummary["deliveryStatus"],
    email: String(row.email),
    expiresAt: Number(row.expires_at),
    id: String(row.id),
    invitedBy: {
      displayName: String(row.invited_by_display_name),
      id: String(row.invited_by_id),
    },
    lastSentAt: row.last_sent_at === null || row.last_sent_at === undefined
      ? null
      : Number(row.last_sent_at),
    role: row.role as WorkspaceInviteRole,
    status: row.status as WorkspaceInviteSummary["status"],
    updatedAt: Number(row.updated_at),
    workspaceId: String(row.workspace_id),
  };
}
