import type { PoolClient } from "pg";

interface WorkspaceAuditEventInput {
  actorUserId: string | null;
  eventType: string;
  metadata: Record<string, unknown>;
  targetId: string;
  targetType: string;
  workspaceId: string;
  workspaceName: string;
}

export class WorkspaceAuditStore {
  constructor(
    private readonly idFactory: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  write(
    client: Pick<PoolClient, "query">,
    input: WorkspaceAuditEventInput,
  ) {
    return client.query(
      "INSERT INTO workspace_audit_events "
        + "(id,workspace_id,workspace_name,actor_user_id,event_type,target_type,target_id,metadata,created_at) "
        + "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        this.idFactory(),
        input.workspaceId,
        input.workspaceName,
        input.actorUserId,
        input.eventType,
        input.targetType,
        input.targetId,
        input.metadata,
        this.now(),
      ],
    );
  }
}
