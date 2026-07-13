import { createClient } from "redis";
import type { AppUser, SessionCache } from "./postgresAuthStore";

interface RedisSessionClient {
  readonly isOpen: boolean;
  connect(): Promise<unknown>;
  del(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { PX: number }): Promise<unknown>;
}

const SESSION_KEY_PREFIX = "notion-editor:session:";

function isAppUser(value: unknown): value is AppUser {
  if (!value || typeof value !== "object") {
    return false;
  }

  const user = value as Record<string, unknown>;
  return typeof user.id === "string" &&
    typeof user.email === "string" &&
    typeof user.displayName === "string";
}

export class RedisSessionCache implements SessionCache {
  private connectPromise: Promise<unknown> | null = null;

  constructor(private readonly client: RedisSessionClient) {}

  async get(tokenHash: string) {
    await this.ensureConnected();
    const value = await this.client.get(this.getKey(tokenHash));
    if (!value) {
      return null;
    }

    try {
      const user = JSON.parse(value) as unknown;
      return isAppUser(user) ? user : null;
    } catch {
      return null;
    }
  }

  async set(tokenHash: string, user: AppUser, ttlMs: number) {
    await this.ensureConnected();
    await this.client.set(this.getKey(tokenHash), JSON.stringify(user), { PX: Math.max(Math.floor(ttlMs), 1) });
  }

  async delete(tokenHash: string) {
    await this.ensureConnected();
    await this.client.del(this.getKey(tokenHash));
  }

  private async ensureConnected() {
    if (this.client.isOpen) {
      return;
    }

    this.connectPromise ??= this.client.connect().finally(() => {
      this.connectPromise = null;
    });
    await this.connectPromise;
  }

  private getKey(tokenHash: string) {
    return `${SESSION_KEY_PREFIX}${tokenHash}`;
  }
}

let sharedCache: { cache: RedisSessionCache; url: string } | null = null;

export function getRedisSessionCache(redisUrl = process.env.REDIS_URL) {
  const url = redisUrl?.trim();
  if (!url) {
    return undefined;
  }
  if (sharedCache?.url === url) {
    return sharedCache.cache;
  }

  const client = createClient({
    socket: {
      connectTimeout: 1000,
      reconnectStrategy: false,
    },
    url,
  });
  client.on("error", () => undefined);
  const cache = new RedisSessionCache(client as RedisSessionClient);
  sharedCache = { cache, url };
  return cache;
}
