// @vitest-environment node
import { createRequire } from "node:module";
import type { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { createPgMemPool } from "../test/pgMemDatabase";
import {
  COLLABORATION_REMOTE_ORIGIN,
  RedisCollaborationPubSub,
} from "./collaborationPubSub";
import { migrateDatabase } from "./database/migrations";
import { PostgresYjsPersistence } from "./yjsPersistence";

const require = createRequire(import.meta.url);
const Y = require("yjs") as typeof import("yjs");
const { Awareness } = require("y-protocols/awareness") as typeof import("y-protocols/awareness");

const resources: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.close();
  }
});

describe("RedisCollaborationPubSub", () => {
  it("propagates updates once across instances while isolating workspace rooms", async () => {
    const broker = new FakeRedisBroker();
    const bridgeA = createBridge(broker, "instance-a");
    const bridgeB = createBridge(broker, "instance-b");
    resources.push(bridgeA, bridgeB);
    const roomA = "workspace:workspace-a:document:document-1";
    const roomB = "workspace:workspace-b:document:document-1";
    const documentA = new Y.Doc();
    const documentB = new Y.Doc();
    const isolatedDocument = new Y.Doc();
    await bridgeA.attachRoom(roomA, documentA, new Awareness(documentA));
    await bridgeB.attachRoom(roomA, documentB, new Awareness(documentB));
    await bridgeB.attachRoom(roomB, isolatedDocument, new Awareness(isolatedDocument));

    documentA.getText("content").insert(0, "shared");
    await waitUntil(() => documentB.getText("content").toString() === "shared");

    expect(isolatedDocument.getText("content").toString()).toBe("");
    expect(broker.messages.filter((message) => JSON.parse(message).kind === "update")).toHaveLength(1);
  });

  it("propagates awareness and removes remote state when the local client disconnects", async () => {
    const broker = new FakeRedisBroker();
    const bridgeA = createBridge(broker, "instance-a");
    const bridgeB = createBridge(broker, "instance-b");
    resources.push(bridgeA, bridgeB);
    const documentA = new Y.Doc();
    const documentB = new Y.Doc();
    const awarenessA = new Awareness(documentA);
    const awarenessB = new Awareness(documentB);
    const roomName = "workspace:workspace-a:document:document-1";
    await bridgeA.attachRoom(roomName, documentA, awarenessA);
    await bridgeB.attachRoom(roomName, documentB, awarenessB);

    awarenessA.setLocalState({ name: "Editor A" });
    await waitUntil(() => awarenessB.getStates().get(awarenessA.clientID)?.name === "Editor A");

    awarenessA.setLocalState(null);
    await waitUntil(() => !awarenessB.getStates().has(awarenessA.clientID));
    expect(awarenessB.getStates().has(awarenessA.clientID)).toBe(false);
  });

  it("persists one logical update when another instance receives it from Redis", async () => {
    const pool = createPgMemPool();
    resources.push({ close: () => pool.end() });
    await migrateDatabase(pool);
    await pool.query(
      "INSERT INTO app_users (id, email, display_name, created_at) VALUES ($1, $2, $3, $4)",
      ["owner-a", "owner-a@example.com", "Owner A", 1000],
    );
    await pool.query(
      `INSERT INTO editor_workspaces (id, name, updated_at, created_at)
       VALUES ($1, $2, $3, $3)`,
      ["workspace-a", "Workspace A", 1000],
    );
    const ignoredOrigins = new Set<unknown>([COLLABORATION_REMOTE_ORIGIN]);
    const persistenceA = new PostgresYjsPersistence(pool, {
      compactionUpdateThreshold: 100,
      ignoredOrigins,
    });
    const persistenceB = new PostgresYjsPersistence(pool, {
      compactionUpdateThreshold: 100,
      ignoredOrigins,
    });
    const broker = new FakeRedisBroker();
    const bridgeA = createBridge(broker, "instance-a");
    const bridgeB = createBridge(broker, "instance-b");
    resources.push(bridgeA, bridgeB);
    const roomName = "workspace:workspace-a:document:document-1";
    const documentA = new Y.Doc();
    const documentB = new Y.Doc();
    await persistenceA.bindState(roomName, documentA);
    await persistenceB.bindState(roomName, documentB);
    await bridgeA.attachRoom(roomName, documentA, new Awareness(documentA));
    await bridgeB.attachRoom(roomName, documentB, new Awareness(documentB));

    documentA.getText("content").insert(0, "persist once");
    await waitUntil(() => documentB.getText("content").toString() === "persist once");
    await persistenceA.flushAll();
    await persistenceB.flushAll();
    const updates = await pool.query(
      "SELECT COUNT(*)::int AS count FROM yjs_room_updates WHERE room_name = $1",
      [roomName],
    );

    expect(Number(updates.rows[0].count)).toBe(1);
  });

  it("keeps local collaboration available when Redis cannot connect", async () => {
    const broker = new FakeRedisBroker();
    const publisher = broker.createClient({ failConnections: true });
    const subscriber = broker.createClient({ failConnections: true });
    const bridge = new RedisCollaborationPubSub({
      instanceId: "offline-instance",
      publisher,
      subscriber,
    });
    resources.push(bridge);
    const document = new Y.Doc();

    await expect(bridge.attachRoom(
      "workspace:workspace-a:document:document-1",
      document,
      new Awareness(document),
    )).resolves.toBeUndefined();
    document.getText("content").insert(0, "local still works");

    expect(document.getText("content").toString()).toBe("local still works");
  });
});

function createBridge(broker: FakeRedisBroker, instanceId: string) {
  return new RedisCollaborationPubSub({
    instanceId,
    publisher: broker.createClient(),
    subscriber: broker.createClient(),
  });
}

class FakeRedisBroker {
  readonly messages: string[] = [];
  private readonly subscriptions = new Map<string, Set<(message: string) => void>>();

  createClient({ failConnections = false }: { failConnections?: boolean } = {}) {
    const broker = this;
    return {
      isOpen: false,
      async connect() {
        if (failConnections) {
          throw new Error("Redis unavailable");
        }
        this.isOpen = true;
      },
      async publish(channel: string, message: string) {
        broker.messages.push(message);
        for (const listener of broker.subscriptions.get(channel) ?? []) {
          queueMicrotask(() => listener(message));
        }
        return broker.subscriptions.get(channel)?.size ?? 0;
      },
      async quit() {
        this.isOpen = false;
        return "OK";
      },
      async subscribe(channel: string, listener: (message: string) => void) {
        const listeners = broker.subscriptions.get(channel) ?? new Set();
        listeners.add(listener);
        broker.subscriptions.set(channel, listeners);
      },
      async unsubscribe(channel: string, listener?: (message: string) => void) {
        const listeners = broker.subscriptions.get(channel);
        if (listener) {
          listeners?.delete(listener);
        } else {
          listeners?.clear();
        }
      },
    };
  }
}

async function waitUntil(condition: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Condition was not met");
}
