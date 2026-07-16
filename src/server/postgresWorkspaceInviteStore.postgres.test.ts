import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPostgresIntegrationContext } from "../test/postgresIntegration";
import { PostgresWorkspaceInviteStore } from "./postgresWorkspaceInviteStore";
import { WorkspaceInviteTokenService } from "./workspaceInviteTokens";

const describeWithPostgres = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeWithPostgres("PostgresWorkspaceInviteStore invitation acceptance", () => {
  let pool: Pool;
  let close: () => Promise<void>;
  let store: PostgresWorkspaceInviteStore;

  beforeEach(async () => {
    const context = await createPostgresIntegrationContext();
    pool = context.pool;
    close = context.close;
    await seedUser(pool, "owner-1", "owner@example.com", "Owner");
    await seedUser(pool, "member-1", "member@example.com", "Member");
    await seedWorkspace(pool, "workspace-1", "Product", "owner-1");
    store = new PostgresWorkspaceInviteStore(pool, {
      tokenService: new WorkspaceInviteTokenService(
        "test-workspace-invite-secret-at-least-32-bytes",
      ),
    });
  });

  afterEach(async () => {
    await close();
  });

  it("accepts concurrently once and creates one membership", async () => {
    const invite = await store.createInvite({
      actorUserId: "owner-1",
      email: "member@example.com",
      role: "editor",
      workspaceId: "workspace-1",
    });
    const input = {
      inviteId: invite.invite.id,
      tokenHash: null,
      userEmail: "member@example.com",
      userId: "member-1",
    };

    const results = await Promise.allSettled([
      store.acceptInvite(input),
      store.acceptInvite(input),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: { code: "invite_already_accepted" },
    });
    await expect(pool.query(
      `SELECT COUNT(*)::int AS count
       FROM workspace_members
       WHERE workspace_id = $1 AND user_id = $2`,
      ["workspace-1", "member-1"],
    )).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });
});

async function seedUser(pool: Pool, id: string, email: string, displayName: string) {
  await pool.query(
    "INSERT INTO app_users (id, email, display_name, created_at) VALUES ($1, $2, $3, $4)",
    [id, email, displayName, 1_000],
  );
}

async function seedWorkspace(
  pool: Pool,
  id: string,
  name: string,
  ownerId: string,
) {
  await pool.query(
    `INSERT INTO editor_workspaces (id, name, updated_at, created_at)
     VALUES ($1, $2, $3, $3)`,
    [id, name, 1_000],
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
     VALUES ($1, $2, 'owner', $3)`,
    [id, ownerId, 1_000],
  );
}
