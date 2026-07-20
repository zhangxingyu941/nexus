import type { Pool, PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPostgresIntegrationContext } from "../test/postgresIntegration";
import { PostgresWorkspaceMemberStore } from "./postgresWorkspaceMemberStore";
import { PostgresWorkspaceAccessListener } from "./workspaceAccessNotifications";

const describeWithPostgres = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeWithPostgres("PostgresWorkspaceMemberStore ownership transfer", () => {
  let close: () => Promise<void>;
  let pool: Pool;

  beforeEach(async () => {
    const context = await createPostgresIntegrationContext();
    close = context.close;
    pool = context.pool;
    await seedUser(pool, "owner-1", "owner@example.com", "Owner");
    await seedUser(pool, "editor-1", "editor@example.com", "Editor");
    await seedWorkspace(pool, "workspace-1", "Product", "owner-1");
    await seedMembership(pool, "workspace-1", "editor-1", "editor");
  });

  afterEach(async () => {
    await close();
  });

  it("serializes transfer against removal and preserves an owner", async () => {
    const blocker = await pool.connect();
    const removeClient = await pool.connect();
    const transferClient = await pool.connect();
    const queuedClients = [removeClient, transferClient];
    const store = new PostgresWorkspaceMemberStore({
      connect: async () => queuedClients.shift(),
    } as Pool);
    const removePid = await loadBackendPid(removeClient);
    const transferPid = await loadBackendPid(transferClient);

    let removal: Promise<void> | undefined;
    let transfer: Promise<void> | undefined;
    let blockerReleased = false;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        `SELECT id
         FROM editor_workspaces
         WHERE id = $1
         FOR UPDATE`,
        ["workspace-1"],
      );

      removal = store.removeMember({
        actorUserId: "owner-1",
        memberId: "editor-1",
        workspaceId: "workspace-1",
      });
      await waitForLock(pool, removePid);
      transfer = store.transferOwnership({
        actorUserId: "owner-1",
        retainOwnerRole: false,
        targetUserId: "editor-1",
        workspaceId: "workspace-1",
      });
      await waitForLock(pool, transferPid);

      await blocker.query("COMMIT");
      blockerReleased = true;
    } finally {
      if (!blockerReleased) {
        await blocker.query("ROLLBACK");
      }
      blocker.release();
    }

    const results = await Promise.allSettled([removal!, transfer!]);
    expect(results[0]).toMatchObject({ status: "fulfilled" });
    expect(results[1]).toMatchObject({
      reason: { code: "ownership_target_invalid" },
      status: "rejected",
    });
    await expect(pool.query(
      `SELECT COUNT(*)::int AS count
       FROM workspace_members
       WHERE workspace_id = $1 AND role = 'owner'`,
      ["workspace-1"],
    )).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("delivers a committed member access invalidation", async () => {
    const listener = new PostgresWorkspaceAccessListener(pool);
    const received: Array<{ userId: string | null; workspaceId: string }> = [];
    listener.on("invalidation", (event) => received.push(event));
    await listener.start();

    try {
      const store = new PostgresWorkspaceMemberStore(pool);
      await store.updateRole({
        actorUserId: "owner-1",
        memberId: "editor-1",
        role: "viewer",
        workspaceId: "workspace-1",
      });

      await waitForInvalidation(received, {
        userId: "editor-1",
        workspaceId: "workspace-1",
      });
    } finally {
      await listener.stop();
    }
  });
});

async function waitForInvalidation(
  received: Array<{ userId: string | null; workspaceId: string }>,
  expected: { userId: string | null; workspaceId: string },
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (received.some((event) => event.userId === expected.userId
      && event.workspaceId === expected.workspaceId)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for workspace access invalidation");
}

async function loadBackendPid(client: PoolClient) {
  const result = await client.query("SELECT pg_backend_pid() AS pid");
  return Number(result.rows[0].pid);
}

async function waitForLock(pool: Pool, pid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT wait_event_type
       FROM pg_stat_activity
       WHERE pid = $1`,
      [pid],
    );
    if (result.rows[0]?.wait_event_type === "Lock") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Backend ${pid} did not wait for the workspace lock`);
}

async function seedUser(
  pool: Pool,
  id: string,
  email: string,
  displayName: string,
) {
  await pool.query(
    "INSERT INTO app_users (id, email, display_name, created_at) VALUES ($1, $2, $3, $4)",
    [id, email, displayName, 1_000],
  );
}

async function seedWorkspace(
  pool: Pool,
  id: string,
  name: string,
  ownerUserId: string,
) {
  await pool.query(
    `INSERT INTO editor_workspaces (id, name, updated_at, created_at)
     VALUES ($1, $2, $3, $3)`,
    [id, name, 1_000],
  );
  await seedMembership(pool, id, ownerUserId, "owner");
}

async function seedMembership(
  pool: Pool,
  workspaceId: string,
  userId: string,
  role: "owner" | "editor" | "viewer",
) {
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
     VALUES ($1, $2, $3, $4)`,
    [workspaceId, userId, role, 1_000],
  );
}
