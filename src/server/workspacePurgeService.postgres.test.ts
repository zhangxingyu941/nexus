import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPostgresIntegrationContext } from "../test/postgresIntegration";
import { PostgresWorkspaceLifecycleStore } from "./postgresWorkspaceLifecycleStore";
import { WorkspacePurgeService } from "./workspacePurgeService";

const describeWithPostgres = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeWithPostgres("WorkspacePurgeService PostgreSQL coordination", () => {
  let close: () => Promise<void>;
  let pool: Pool;

  beforeEach(async () => {
    const context = await createPostgresIntegrationContext();
    close = context.close;
    pool = context.pool;
    await pool.query(
      `INSERT INTO editor_workspaces
       (id, name, updated_at, created_at, deleted_at, purge_after)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ["workspace-1", "Product", 1_000, 1_000, -604_799_000, 1_000],
    );
  });

  afterEach(async () => {
    await close();
  });

  it("purges a concurrent tombstone once and audits before deleting it", async () => {
    let startDelete: (() => void) | undefined;
    const deletionStarted = new Promise<void>((resolve) => {
      startDelete = resolve;
    });
    let finishDelete: (() => void) | undefined;
    const deletionFinished = new Promise<void>((resolve) => {
      finishDelete = resolve;
    });
    const objectStorage = {
      deletePrefix: vi.fn(async () => {
        startDelete!();
        await deletionFinished;
      }),
    };
    const createService = () => new WorkspacePurgeService({
      lifecycleStore: new PostgresWorkspaceLifecycleStore(pool, { now: () => 2_000 }),
      objectStorage,
    });

    const first = createService().purgeExpired(3);
    await deletionStarted;
    const second = createService().purgeExpired(3);
    await second;
    finishDelete!();
    await first;

    expect(objectStorage.deletePrefix).toHaveBeenCalledTimes(1);
    await expect(pool.query(
      "SELECT event_type FROM workspace_audit_events WHERE workspace_id = $1",
      ["workspace-1"],
    )).resolves.toMatchObject({ rows: [{ event_type: "workspace_purged" }] });
    await expect(pool.query(
      "SELECT id FROM editor_workspaces WHERE id = $1",
      ["workspace-1"],
    )).resolves.toMatchObject({ rows: [] });
  });

  it("retries a retained tombstone after object storage recovers", async () => {
    const objectStorage = {
      deletePrefix: vi.fn()
        .mockRejectedValueOnce(new Error("storage down"))
        .mockResolvedValueOnce(undefined),
    };
    const service = new WorkspacePurgeService({
      lifecycleStore: new PostgresWorkspaceLifecycleStore(pool, { now: () => 2_000 }),
      logger: { error: vi.fn() },
      objectStorage,
    });

    await service.purgeExpired(3);
    await expect(pool.query(
      "SELECT id FROM editor_workspaces WHERE id = $1",
      ["workspace-1"],
    )).resolves.toMatchObject({ rows: [{ id: "workspace-1" }] });

    await service.purgeExpired(3);

    expect(objectStorage.deletePrefix).toHaveBeenCalledTimes(2);
    await expect(pool.query(
      "SELECT id FROM editor_workspaces WHERE id = $1",
      ["workspace-1"],
    )).resolves.toMatchObject({ rows: [] });
  });
});
