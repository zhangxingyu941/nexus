import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createClient } from "redis";
import type { Awareness } from "y-protocols/awareness";
import type * as Yjs from "yjs";

const require = createRequire(import.meta.url);
const { applyAwarenessUpdate, encodeAwarenessUpdate } = require("y-protocols/awareness") as typeof import("y-protocols/awareness");
const Y = require("yjs") as typeof Yjs;

export const COLLABORATION_REMOTE_ORIGIN = Symbol("collaboration-remote-origin");

interface RedisPublisherClient {
  readonly isOpen: boolean;
  connect(): Promise<unknown>;
  publish(channel: string, message: string): Promise<number>;
  quit(): Promise<unknown>;
}

interface RedisSubscriberClient {
  readonly isOpen: boolean;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  subscribe(channel: string, listener: (message: string) => void): Promise<unknown>;
  unsubscribe(channel: string, listener?: (message: string) => void): Promise<unknown>;
}

interface RedisCollaborationPubSubOptions {
  instanceId: string;
  publisher: RedisPublisherClient;
  subscriber: RedisSubscriberClient;
}

interface CollaborationMessage {
  instanceId: string;
  kind: "awareness" | "update";
  payload: string;
}

interface RoomBinding {
  awareness: Awareness;
  channel: string;
  document: Yjs.Doc;
  onAwareness: (
    changes: { added: number[]; removed: number[]; updated: number[] },
    origin: unknown,
  ) => void;
  onDestroy: () => void;
  onMessage: (message: string) => void;
  onUpdate: (update: Uint8Array, origin: unknown) => void;
  roomName: string;
  subscribed: boolean;
}

export class RedisCollaborationPubSub {
  private closed = false;
  private publisherConnectPromise: Promise<unknown> | null = null;
  private readonly rooms = new Map<string, RoomBinding>();
  private subscriberConnectPromise: Promise<unknown> | null = null;

  constructor(private readonly options: RedisCollaborationPubSubOptions) {}

  async attachRoom(roomName: string, document: Yjs.Doc, awareness: Awareness): Promise<void> {
    if (this.closed) {
      return;
    }

    const existing = this.rooms.get(roomName);
    if (existing) {
      if (existing.document !== document) {
        throw new Error("Collaboration room is already attached to another document");
      }
      await this.subscribe(existing);
      return;
    }

    const binding: RoomBinding = {
      awareness,
      channel: getRoomChannel(roomName),
      document,
      onAwareness: () => undefined,
      onDestroy: () => undefined,
      onMessage: () => undefined,
      onUpdate: () => undefined,
      roomName,
      subscribed: false,
    };
    binding.onUpdate = (update, origin) => {
      if (origin !== COLLABORATION_REMOTE_ORIGIN) {
        void this.publish(binding, "update", update);
      }
    };
    binding.onAwareness = ({ added, removed, updated }, origin) => {
      if (origin === COLLABORATION_REMOTE_ORIGIN) {
        return;
      }
      const changedClients = [...added, ...updated, ...removed];
      if (changedClients.length > 0) {
        void this.publish(binding, "awareness", encodeAwarenessUpdate(awareness, changedClients));
      }
    };
    binding.onMessage = (message) => this.applyMessage(binding, message);
    binding.onDestroy = () => {
      void this.detachRoom(roomName);
    };

    document.on("update", binding.onUpdate);
    document.on("destroy", binding.onDestroy);
    awareness.on("update", binding.onAwareness);
    this.rooms.set(roomName, binding);
    await this.subscribe(binding);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await Promise.all([...this.rooms.keys()].map((roomName) => this.detachRoom(roomName)));
    await Promise.all([
      closeRedisClient(this.options.publisher),
      closeRedisClient(this.options.subscriber),
    ]);
  }

  private async subscribe(binding: RoomBinding) {
    if (binding.subscribed || this.closed) {
      return;
    }
    try {
      await this.ensureSubscriberConnected();
      await this.options.subscriber.subscribe(binding.channel, binding.onMessage);
      binding.subscribed = true;
    } catch {
      binding.subscribed = false;
    }
  }

  private async publish(
    binding: RoomBinding,
    kind: CollaborationMessage["kind"],
    update: Uint8Array,
  ) {
    if (this.closed) {
      return;
    }
    try {
      await this.ensurePublisherConnected();
      await this.options.publisher.publish(binding.channel, JSON.stringify({
        instanceId: this.options.instanceId,
        kind,
        payload: Buffer.from(update).toString("base64"),
      } satisfies CollaborationMessage));
    } catch {
      // Redis transport is optional for local collaboration availability.
    }
  }

  private applyMessage(binding: RoomBinding, value: string) {
    const message = parseMessage(value);
    if (!message || message.instanceId === this.options.instanceId) {
      return;
    }

    const update = Uint8Array.from(Buffer.from(message.payload, "base64"));
    if (message.kind === "update") {
      Y.applyUpdate(binding.document, update, COLLABORATION_REMOTE_ORIGIN);
      return;
    }
    applyAwarenessUpdate(binding.awareness, update, COLLABORATION_REMOTE_ORIGIN);
  }

  private async detachRoom(roomName: string) {
    const binding = this.rooms.get(roomName);
    if (!binding) {
      return;
    }
    this.rooms.delete(roomName);
    binding.document.off("update", binding.onUpdate);
    binding.document.off("destroy", binding.onDestroy);
    binding.awareness.off("update", binding.onAwareness);
    if (binding.subscribed && this.options.subscriber.isOpen) {
      try {
        await this.options.subscriber.unsubscribe(binding.channel, binding.onMessage);
      } catch {
        // The Redis connection may already be gone during shutdown.
      }
    }
  }

  private async ensurePublisherConnected() {
    if (this.options.publisher.isOpen) {
      return;
    }
    this.publisherConnectPromise ??= this.options.publisher.connect().finally(() => {
      this.publisherConnectPromise = null;
    });
    await this.publisherConnectPromise;
  }

  private async ensureSubscriberConnected() {
    if (this.options.subscriber.isOpen) {
      return;
    }
    this.subscriberConnectPromise ??= this.options.subscriber.connect().finally(() => {
      this.subscriberConnectPromise = null;
    });
    await this.subscriberConnectPromise;
  }
}

export function createRedisCollaborationPubSub(
  redisUrl = process.env.REDIS_URL,
  instanceId = randomUUID(),
) {
  const url = redisUrl?.trim();
  if (!url) {
    return undefined;
  }

  const publisher = createClient({ url });
  const subscriber = createClient({ url });
  publisher.on("error", () => undefined);
  subscriber.on("error", () => undefined);
  return new RedisCollaborationPubSub({
    instanceId,
    publisher: publisher as RedisPublisherClient,
    subscriber: subscriber as RedisSubscriberClient,
  });
}

function getRoomChannel(roomName: string) {
  return `notion-editor:collaboration:${Buffer.from(roomName).toString("base64url")}`;
}

function parseMessage(value: string): CollaborationMessage | null {
  try {
    const message = JSON.parse(value) as Record<string, unknown>;
    if (
      typeof message.instanceId !== "string" ||
      (message.kind !== "update" && message.kind !== "awareness") ||
      typeof message.payload !== "string"
    ) {
      return null;
    }
    return message as unknown as CollaborationMessage;
  } catch {
    return null;
  }
}

async function closeRedisClient(client: RedisPublisherClient | RedisSubscriberClient) {
  if (!client.isOpen) {
    return;
  }
  try {
    await client.quit();
  } catch {
    // A disconnected Redis client is already closed from this process's perspective.
  }
}
