// @vitest-environment node
import { createRequire } from "node:module";
import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "./database/migrations";
import { PostgresYjsPersistence } from "./yjsPersistence";

const require = createRequire(import.meta.url);
const Y = require("yjs") as typeof import("yjs");

describe("PostgresYjsPersistence", () => {
  let pool: Pool;

  beforeEach(async () => {
    const memoryDatabase = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = memoryDatabase.adapters.createPg();
    pool = new adapter.Pool() as Pool;
    await migrateDatabase(pool);
    await seedWorkspace(pool, "workspace-a", "owner-a", "owner-a@example.com");
    await seedWorkspace(pool, "workspace-b", "owner-b", "owner-b@example.com");
  });

  afterEach(async () => {
    await pool.end();
  });

  it("loads a room snapshot and its incremental updates without crossing workspaces", async () => {
    const roomA = "workspace:workspace-a:document:document-1";
    const roomB = "workspace:workspace-b:document:document-1";
    const sourceA = new Y.Doc();
    const updatesA: Uint8Array[] = [];
    sourceA.on("update", (update) => updatesA.push(update));
    sourceA.getText("content").insert(0, "A");
    const snapshotA = Y.encodeStateAsUpdate(sourceA);
    sourceA.getText("content").insert(1, "B");
    sourceA.getText("content").insert(2, "C");

    const sourceB = new Y.Doc();
    sourceB.getText("content").insert(0, "other");
    await insertSnapshot(pool, "workspace-a", roomA, snapshotA);
    await insertUpdate(pool, "workspace-a", roomA, updatesA[1], 1);
    await insertUpdate(pool, "workspace-a", roomA, updatesA[2], 2);
    await insertSnapshot(pool, "workspace-b", roomB, Y.encodeStateAsUpdate(sourceB));

    const persistence = new PostgresYjsPersistence(pool);
    const restoredA = new Y.Doc();
    const restoredB = new Y.Doc();
    await persistence.bindState(roomA, restoredA);
    await persistence.bindState(roomB, restoredB);

    expect(restoredA.getText("content").toString()).toBe("ABC");
    expect(restoredB.getText("content").toString()).toBe("other");
  });

  it("appends local updates and reconstructs the room after a process restart", async () => {
    const roomName = "workspace:workspace-a:document:document-1";
    const firstProcess = new PostgresYjsPersistence(pool, {
      compactionByteThreshold: 1_000_000,
      compactionUpdateThreshold: 100,
    });
    const activeDocument = new Y.Doc();
    await firstProcess.bindState(roomName, activeDocument);
    activeDocument.getText("content").insert(0, "persisted");
    activeDocument.getText("content").insert(9, " room");
    await firstProcess.flushAll();

    const storedUpdates = await pool.query(
      "SELECT id FROM yjs_room_updates WHERE workspace_id = $1 AND room_name = $2 ORDER BY id",
      ["workspace-a", roomName],
    );
    expect(storedUpdates.rows).toHaveLength(2);
    expect(Number(storedUpdates.rows[0].id)).toBeLessThan(Number(storedUpdates.rows[1].id));

    const secondProcess = new PostgresYjsPersistence(pool);
    const restoredDocument = new Y.Doc();
    await secondProcess.bindState(roomName, restoredDocument);

    expect(restoredDocument.getText("content").toString()).toBe("persisted room");
  });

  it("compacts accumulated updates into one restart-safe snapshot", async () => {
    const roomName = "workspace:workspace-a:document:document-compact";
    const persistence = new PostgresYjsPersistence(pool, {
      compactionByteThreshold: 1_000_000,
      compactionUpdateThreshold: 2,
    });
    const document = new Y.Doc();
    await persistence.bindState(roomName, document);
    document.getText("content").insert(0, "first");
    document.getText("content").insert(5, " second");
    await persistence.flushAll();

    const snapshotCount = await countRows(pool, "yjs_room_snapshots", roomName);
    const updateCount = await countRows(pool, "yjs_room_updates", roomName);
    expect(snapshotCount).toBe(1);
    expect(updateCount).toBe(0);

    const restartedPersistence = new PostgresYjsPersistence(pool);
    const restoredDocument = new Y.Doc();
    await restartedPersistence.bindState(roomName, restoredDocument);
    expect(restoredDocument.getText("content").toString()).toBe("first second");
  });
});

async function seedWorkspace(pool: Pool, workspaceId: string, userId: string, email: string) {
  await pool.query(
    "INSERT INTO app_users (id, email, display_name, created_at) VALUES ($1, $2, $3, $4)",
    [userId, email, userId, 1000],
  );
  await pool.query(
    `INSERT INTO editor_workspaces (id, name, owner_id, active_document_id, updated_at, created_at)
     VALUES ($1, $2, $3, NULL, $4, $4)`,
    [workspaceId, workspaceId, userId, 1000],
  );
}

async function insertSnapshot(pool: Pool, workspaceId: string, roomName: string, update: Uint8Array) {
  await pool.query(
    `INSERT INTO yjs_room_snapshots (workspace_id, room_name, snapshot, updated_at)
     VALUES ($1, $2, $3, $4)`,
    [workspaceId, roomName, Buffer.from(update).toString("base64"), 1000],
  );
}

async function insertUpdate(
  pool: Pool,
  workspaceId: string,
  roomName: string,
  update: Uint8Array,
  createdAt: number,
) {
  await pool.query(
    `INSERT INTO yjs_room_updates (workspace_id, room_name, update_data, byte_length, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [workspaceId, roomName, Buffer.from(update).toString("base64"), update.byteLength, createdAt],
  );
}

async function countRows(pool: Pool, table: "yjs_room_snapshots" | "yjs_room_updates", roomName: string) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM ${table} WHERE room_name = $1`,
    [roomName],
  );
  return Number(result.rows[0].count);
}
