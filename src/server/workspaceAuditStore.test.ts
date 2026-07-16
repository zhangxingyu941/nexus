import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceAuditStore } from "./workspaceAuditStore";

describe("WorkspaceAuditStore", () => {
  it("writes a timestamped workspace audit event with parameterized values", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new WorkspaceAuditStore(() => "audit-1", () => 1000);

    await store.write({ query } as unknown as Pick<PoolClient, "query">, {
      actorUserId: "user-1",
      eventType: "invite.created",
      metadata: { role: "editor" },
      targetId: "invite-1",
      targetType: "workspace_invite",
      workspaceId: "workspace-1",
      workspaceName: "Product",
    });

    expect(query).toHaveBeenCalledWith(
      "INSERT INTO workspace_audit_events "
        + "(id,workspace_id,workspace_name,actor_user_id,event_type,target_type,target_id,metadata,created_at) "
        + "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        "audit-1",
        "workspace-1",
        "Product",
        "user-1",
        "invite.created",
        "workspace_invite",
        "invite-1",
        { role: "editor" },
        1000,
      ],
    );
  });
});
