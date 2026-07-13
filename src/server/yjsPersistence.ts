import { createRequire } from "node:module";
import type { Pool } from "pg";
import type * as Yjs from "yjs";

const require = createRequire(import.meta.url);
const Y = require("yjs") as typeof Yjs;

interface PostgresYjsPersistenceOptions {
  compactionByteThreshold?: number;
  compactionUpdateThreshold?: number;
  ignoredOrigins?: ReadonlySet<unknown>;
  now?: () => number;
}

interface RoomState {
  document: Yjs.Doc;
  onUpdate: (update: Uint8Array, origin: unknown) => void;
  pending: Promise<void>;
  ready: Promise<void>;
  roomName: string;
  updateBytes: number;
  updateCount: number;
  workspaceId: string;
}

const DEFAULT_COMPACTION_BYTE_THRESHOLD = 1024 * 1024;
const DEFAULT_COMPACTION_UPDATE_THRESHOLD = 100;
const PERSISTENCE_LOAD_ORIGIN = Symbol("postgres-yjs-load");

export class PostgresYjsPersistence {
  readonly provider = this;
  private readonly compactionByteThreshold: number;
  private readonly compactionUpdateThreshold: number;
  private readonly ignoredOrigins: ReadonlySet<unknown>;
  private readonly now: () => number;
  private readonly rooms = new Map<Yjs.Doc, RoomState>();

  constructor(
    private readonly pool: Pool,
    options: PostgresYjsPersistenceOptions = {},
  ) {
    this.compactionByteThreshold = getPositiveInteger(
      options.compactionByteThreshold ?? DEFAULT_COMPACTION_BYTE_THRESHOLD,
      "compactionByteThreshold",
    );
    this.compactionUpdateThreshold = getPositiveInteger(
      options.compactionUpdateThreshold ?? DEFAULT_COMPACTION_UPDATE_THRESHOLD,
      "compactionUpdateThreshold",
    );
    this.ignoredOrigins = options.ignoredOrigins ?? new Set();
    this.now = options.now ?? Date.now;
  }

  bindState(roomName: string, document: Yjs.Doc): Promise<void> {
    const existingState = this.rooms.get(document);
    if (existingState) {
      if (existingState.roomName !== roomName) {
        throw new Error("Yjs document is already bound to another room");
      }
      return existingState.ready;
    }

    const workspaceId = getWorkspaceId(roomName);
    const state: RoomState = {
      document,
      onUpdate: () => undefined,
      pending: Promise.resolve(),
      ready: Promise.resolve(),
      roomName,
      updateBytes: 0,
      updateCount: 0,
      workspaceId,
    };
    state.onUpdate = (update, origin) => {
      if (origin === PERSISTENCE_LOAD_ORIGIN || this.ignoredOrigins.has(origin)) {
        return;
      }
      const copiedUpdate = Uint8Array.from(update);
      state.pending = state.pending.then(() => this.appendUpdate(state, copiedUpdate));
    };
    state.ready = this.loadState(state).then(() => {
      document.on("update", state.onUpdate);
    });
    this.rooms.set(document, state);

    return state.ready;
  }

  async waitUntilReady(document: Yjs.Doc) {
    const state = this.rooms.get(document);
    if (!state) {
      throw new Error("Yjs document is not bound to persistence");
    }
    await state.ready;
  }

  async writeState(roomName: string, document: Yjs.Doc): Promise<void> {
    const state = this.rooms.get(document);
    if (!state || state.roomName !== roomName) {
      return;
    }

    await state.ready;
    await state.pending;
    document.off("update", state.onUpdate);
    this.rooms.delete(document);
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.rooms.values()].map(async (state) => {
      await state.ready;
      await state.pending;
    }));
  }

  private async loadState(state: RoomState) {
    const snapshotResult = await this.pool.query(
      `SELECT snapshot
       FROM yjs_room_snapshots
       WHERE workspace_id = $1 AND room_name = $2`,
      [state.workspaceId, state.roomName],
    );
    const snapshot = snapshotResult.rows[0]?.snapshot;
    if (snapshot) {
      Y.applyUpdate(state.document, toUint8Array(snapshot), PERSISTENCE_LOAD_ORIGIN);
    }

    const updateResult = await this.pool.query(
      `SELECT update_data, byte_length
       FROM yjs_room_updates
       WHERE workspace_id = $1 AND room_name = $2
       ORDER BY id ASC`,
      [state.workspaceId, state.roomName],
    );
    for (const row of updateResult.rows) {
      Y.applyUpdate(state.document, toUint8Array(row.update_data), PERSISTENCE_LOAD_ORIGIN);
      state.updateCount += 1;
      state.updateBytes += Number(row.byte_length);
    }
  }

  private async appendUpdate(state: RoomState, update: Uint8Array) {
    await this.pool.query(
      `INSERT INTO yjs_room_updates
       (workspace_id, room_name, update_data, byte_length, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [state.workspaceId, state.roomName, Buffer.from(update).toString("base64"), update.byteLength, this.now()],
    );
    state.updateCount += 1;
    state.updateBytes += update.byteLength;

    if (
      state.updateCount >= this.compactionUpdateThreshold ||
      state.updateBytes >= this.compactionByteThreshold
    ) {
      await this.compactRoom(state);
    }
  }

  private async compactRoom(state: RoomState) {
    const snapshot = Y.encodeStateAsUpdate(state.document);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO yjs_room_snapshots (workspace_id, room_name, snapshot, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, room_name)
         DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = EXCLUDED.updated_at`,
        [state.workspaceId, state.roomName, Buffer.from(snapshot).toString("base64"), this.now()],
      );
      await client.query(
        "DELETE FROM yjs_room_updates WHERE workspace_id = $1 AND room_name = $2",
        [state.workspaceId, state.roomName],
      );
      await client.query("COMMIT");
      state.updateCount = 0;
      state.updateBytes = 0;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function getWorkspaceId(roomName: string) {
  const match = /^workspace:([^:]+):document:.+$/.exec(roomName);
  if (!match) {
    throw new Error("Yjs room name must be workspace scoped");
  }
  return match[1];
}

function getPositiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function toUint8Array(value: unknown) {
  if (typeof value === "string") {
    return Uint8Array.from(Buffer.from(value, "base64"));
  }
  throw new Error("Stored Yjs update is not base64 data");
}
