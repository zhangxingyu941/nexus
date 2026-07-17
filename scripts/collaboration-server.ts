import "dotenv/config";
import { createRequire } from "node:module";
import type { IncomingMessage } from "node:http";
import type WebSocket from "ws";
import { createPostgresServices } from "../src/server/applicationServices";
import {
  COLLABORATION_REMOTE_ORIGIN,
  createRedisCollaborationPubSub,
} from "../src/server/collaborationPubSub";
import { createCollaborationServer } from "../src/server/collaborationServer";
import { createDatabasePool } from "../src/server/database/pool";
import { PostgresWorkspaceAccessListener } from "../src/server/workspaceAccessNotifications";
import { PostgresYjsPersistence } from "../src/server/yjsPersistence";
import type { Awareness } from "y-protocols/awareness";

type SetupWSConnection = (
  socket: WebSocket,
  request: IncomingMessage,
  options: { docName: string },
) => void;

const require = createRequire(import.meta.url);
type SharedYjsDocument = import("yjs").Doc & { awareness: Awareness };
const { getYDoc, setPersistence, setupWSConnection } = require("y-websocket/bin/utils") as {
  getYDoc(roomName: string): SharedYjsDocument;
  setPersistence(persistence: {
    bindState(roomName: string, document: import("yjs").Doc): Promise<void>;
    provider: unknown;
    writeState(roomName: string, document: import("yjs").Doc): Promise<void>;
  }): void;
  setupWSConnection: SetupWSConnection;
};
const host = process.env.COLLAB_HOST ?? process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.COLLAB_PORT ?? process.env.PORT ?? "1234");
const configuredOrigins = process.env.COLLAB_ALLOWED_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = configuredOrigins?.length
  ? configuredOrigins
  : ["http://localhost:3000", "http://127.0.0.1:3000"];

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("COLLAB_PORT / PORT 必须是有效端口");
}

const pool = createDatabasePool();
const { authStore, workspaceStore } = createPostgresServices(pool);
const collaborationPubSub = createRedisCollaborationPubSub();
const accessInvalidations = new PostgresWorkspaceAccessListener(pool);
await accessInvalidations.start();
const yjsPersistence = new PostgresYjsPersistence(pool, {
  compactionByteThreshold: Number(process.env.COLLAB_YJS_COMPACTION_BYTES ?? 1024 * 1024),
  compactionUpdateThreshold: Number(process.env.COLLAB_YJS_COMPACTION_UPDATES ?? 100),
  ignoredOrigins: new Set([COLLABORATION_REMOTE_ORIGIN]),
});
setPersistence({
  bindState: (roomName, document) => yjsPersistence.bindState(roomName, document),
  provider: yjsPersistence,
  writeState: (roomName, document) => yjsPersistence.writeState(roomName, document),
});
const collaborationServer = createCollaborationServer({
  accessInvalidations,
  allowedOrigins,
  authStore,
  flushRooms: () => yjsPersistence.flushAll(),
  prepareRoom: async (roomName) => {
    const document = getYDoc(roomName);
    await yjsPersistence.waitUntilReady(document);
    await collaborationPubSub?.attachRoom(roomName, document, document.awareness);
  },
  setupConnection: setupWSConnection,
  workspaceStore,
});
let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await collaborationServer.close();
  await accessInvalidations.stop();
  await collaborationPubSub?.close();
  await pool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await collaborationServer.listen(port, host);
console.log(`authenticated collaboration server running at '${host}' on port ${port}`);
