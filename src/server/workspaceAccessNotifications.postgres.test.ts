import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresWorkspaceAccessListener, notifyWorkspaceAccessInvalidation } from "./workspaceAccessNotifications";

function createRealPool(): Pool {
  const { Pool } = require("pg") as typeof import("pg");
  return new Pool({ connectionString: process.env.TEST_DATABASE_URL });
}

describe("PostgresWorkspaceAccessListener (real PostgreSQL)", () => {
  let pool: Pool;

  beforeEach(() => {
    pool = createRealPool();
  });

  afterEach(async () => {
    await pool.end();
  });

  it("receives a committed notification", async () => {
    const listener = new PostgresWorkspaceAccessListener(pool);
    const received: Array<{ workspaceId: string; userId: string | null }> = [];
    listener.on("invalidation", (event) => received.push(event));
    await listener.start();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await notifyWorkspaceAccessInvalidation(client, {
        userId: "user-1",
        workspaceId: "workspace-1",
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toEqual([
      { userId: "user-1", workspaceId: "workspace-1" },
    ]);

    await listener.stop();
  });

  it("does not deliver on rollback", async () => {
    const listener = new PostgresWorkspaceAccessListener(pool);
    const received: Array<{ workspaceId: string; userId: string | null }> = [];
    listener.on("invalidation", (event) => received.push(event));
    await listener.start();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await notifyWorkspaceAccessInvalidation(client, {
        userId: "user-1",
        workspaceId: "workspace-1",
      });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(received).toEqual([]);

    await listener.stop();
  });
});
