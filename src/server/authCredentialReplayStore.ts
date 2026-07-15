import { createHmac } from "node:crypto";
import { createClient } from "redis";

const REDIS_KEY_PREFIX = "notion-editor:auth-credential:";
const encoder = new TextEncoder();

export interface AuthCredentialReplayStore {
  consume(jti: string, expiresAt: number): Promise<boolean>;
}

export interface RedisAuthCredentialReplayClient {
  readonly isOpen: boolean;
  connect(): Promise<unknown>;
  on?(event: "error", listener: (error: unknown) => void): unknown;
  set(
    key: string,
    value: "1",
    options: { NX: true; PX: number },
  ): Promise<string | null>;
}

export class AuthCredentialServiceUnavailableError extends Error {
  readonly code = "credential_service_unavailable" as const;

  constructor() {
    super("安全凭据服务未正确配置，请联系管理员");
    this.name = "AuthCredentialServiceUnavailableError";
  }
}

export class InMemoryAuthCredentialReplayStore implements AuthCredentialReplayStore {
  private readonly entries = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  async consume(jti: string, expiresAt: number): Promise<boolean> {
    validateReplayInput(jti, expiresAt);
    const now = this.now();
    for (const [storedJti, storedExpiresAt] of this.entries) {
      if (storedExpiresAt <= now) {
        this.entries.delete(storedJti);
      }
    }

    if (expiresAt <= now) {
      return false;
    }

    if (this.entries.has(jti)) {
      return false;
    }

    this.entries.set(jti, expiresAt);
    return true;
  }
}

export class RedisAuthCredentialReplayStore implements AuthCredentialReplayStore {
  private connectPromise: Promise<unknown> | null = null;

  constructor(
    private readonly client: RedisAuthCredentialReplayClient,
    private readonly hashSecret: string,
    private readonly now: () => number = Date.now,
  ) {
    validateHashSecret(hashSecret);
  }

  async consume(jti: string, expiresAt: number): Promise<boolean> {
    validateReplayInput(jti, expiresAt);
    const now = this.now();
    if (expiresAt <= now) {
      return false;
    }
    const ttlMs = Math.max(1, Math.ceil(expiresAt - now));

    try {
      await this.ensureConnected();
      const result = await this.client.set(
        createReplayKey(jti, this.hashSecret),
        "1",
        { NX: true, PX: ttlMs },
      );
      if (result === "OK") {
        return true;
      }
      if (result === null) {
        return false;
      }
      throw new AuthCredentialServiceUnavailableError();
    } catch (error) {
      if (error instanceof AuthCredentialServiceUnavailableError) {
        throw error;
      }
      throw new AuthCredentialServiceUnavailableError();
    }
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
}

class UnavailableAuthCredentialReplayStore implements AuthCredentialReplayStore {
  async consume(): Promise<boolean> {
    throw new AuthCredentialServiceUnavailableError();
  }
}

class DevelopmentFallbackAuthCredentialReplayStore implements AuthCredentialReplayStore {
  constructor(
    private readonly primary: AuthCredentialReplayStore,
    private readonly fallback: AuthCredentialReplayStore,
  ) {}

  async consume(jti: string, expiresAt: number): Promise<boolean> {
    try {
      const primaryConsumed = await this.primary.consume(jti, expiresAt);
      const fallbackConsumed = await this.fallback.consume(jti, expiresAt);
      return primaryConsumed && fallbackConsumed;
    } catch {
      return this.fallback.consume(jti, expiresAt);
    }
  }
}

export function createAuthCredentialReplayStore({
  hashSecret,
  production,
  redisClient,
  redisUrl,
}: {
  hashSecret: string;
  production: boolean;
  redisClient?: RedisAuthCredentialReplayClient;
  redisUrl: string | undefined;
}): AuthCredentialReplayStore {
  validateHashSecret(hashSecret);
  const url = redisUrl?.trim();
  if (!url && !redisClient) {
    return production
      ? new UnavailableAuthCredentialReplayStore()
      : new InMemoryAuthCredentialReplayStore();
  }

  const client = redisClient ?? createClient({
    socket: {
      connectTimeout: 1000,
      reconnectStrategy: false,
    },
    url,
  }) as RedisAuthCredentialReplayClient;
  client.on?.("error", () => undefined);

  const redisStore = new RedisAuthCredentialReplayStore(client, hashSecret);
  return production
    ? redisStore
    : new DevelopmentFallbackAuthCredentialReplayStore(
      redisStore,
      new InMemoryAuthCredentialReplayStore(),
    );
}

function createReplayKey(jti: string, hashSecret: string) {
  const hash = createHmac("sha256", hashSecret).update(jti).digest("hex");
  return `${REDIS_KEY_PREFIX}${hash}`;
}

function validateHashSecret(hashSecret: string) {
  if (!hashSecret.trim() || encoder.encode(hashSecret).byteLength < 32) {
    throw new AuthCredentialServiceUnavailableError();
  }
}

function validateReplayInput(jti: string, expiresAt: number) {
  if (!jti || !Number.isFinite(expiresAt)) {
    throw new AuthCredentialServiceUnavailableError();
  }
}
