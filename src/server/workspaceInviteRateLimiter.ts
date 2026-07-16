import { createHmac } from "node:crypto";
import { createClient } from "redis";

const WINDOW_MS = 60 * 60 * 1000;
const WORKSPACE_LIMIT = 20;
const EMAIL_LIMIT = 5;
const REDIS_KEY_PREFIX = "notion-editor:workspace-invite-rate:";

export type WorkspaceInviteRateLimitScope = "workspace" | "email";

export interface WorkspaceInviteRateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
  scope: WorkspaceInviteRateLimitScope | null;
}

export interface WorkspaceInviteRateLimiter {
  consume(workspaceId: string, email: string): Promise<WorkspaceInviteRateLimitResult>;
}

export interface RedisWorkspaceInviteRateLimitClient {
  readonly isOpen: boolean;
  connect(): Promise<unknown>;
  on?(event: "error", listener: (error: unknown) => void): unknown;
  eval(
    script: string,
    options: { arguments: string[]; keys: string[] },
  ): Promise<unknown>;
}

const RATE_LIMIT_SCRIPT = `
local workspaceCount = redis.call('INCR', KEYS[1])
if workspaceCount == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local workspaceTtl = redis.call('PTTL', KEYS[1])

local emailCount = redis.call('INCR', KEYS[2])
if emailCount == 1 then
  redis.call('PEXPIRE', KEYS[2], ARGV[1])
end
local emailTtl = redis.call('PTTL', KEYS[2])

return {workspaceCount, workspaceTtl, emailCount, emailTtl}
`;

export class WorkspaceInviteRateLimitUnavailableError extends Error {
  readonly code = "service_unavailable" as const;

  constructor() {
    super("Workspace invitation rate limiting is unavailable");
    this.name = "WorkspaceInviteRateLimitUnavailableError";
  }
}

export class RedisWorkspaceInviteRateLimiter implements WorkspaceInviteRateLimiter {
  private connectPromise: Promise<unknown> | null = null;

  constructor(
    private readonly client: RedisWorkspaceInviteRateLimitClient,
    private readonly hashSecret: string,
  ) {}

  async consume(workspaceId: string, email: string): Promise<WorkspaceInviteRateLimitResult> {
    try {
      const normalized = normalizeInput(workspaceId, email);
      await this.ensureConnected();
      const response = await this.client.eval(RATE_LIMIT_SCRIPT, {
        arguments: [String(WINDOW_MS)],
        keys: [
          createRedisKey("workspace", normalized.workspaceId, this.hashSecret),
          createRedisKey("email", normalized.email, this.hashSecret),
        ],
      });
      return parseRateLimitResult(response);
    } catch (error) {
      if (error instanceof WorkspaceInviteRateLimitUnavailableError) {
        throw error;
      }
      throw new WorkspaceInviteRateLimitUnavailableError();
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

export class InMemoryWorkspaceInviteRateLimiter implements WorkspaceInviteRateLimiter {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async consume(workspaceId: string, email: string): Promise<WorkspaceInviteRateLimitResult> {
    const normalized = normalizeInput(workspaceId, email);
    const now = this.now();
    const workspace = this.increment("workspace", normalized.workspaceId, now);
    const recipient = this.increment("email", normalized.email, now);
    return toRateLimitResult(workspace, recipient);
  }

  private increment(scope: WorkspaceInviteRateLimitScope, identifier: string, now: number) {
    const key = `${scope}:${identifier}`;
    const existing = this.entries.get(key);
    const entry = !existing || existing.expiresAt <= now
      ? { count: 0, expiresAt: now + WINDOW_MS }
      : existing;
    entry.count += 1;
    this.entries.set(key, entry);
    return {
      count: entry.count,
      retryAfterMs: Math.max(entry.expiresAt - now, 0),
    };
  }
}

class UnavailableWorkspaceInviteRateLimiter implements WorkspaceInviteRateLimiter {
  async consume(): Promise<WorkspaceInviteRateLimitResult> {
    throw new WorkspaceInviteRateLimitUnavailableError();
  }
}

class DevelopmentFallbackWorkspaceInviteRateLimiter implements WorkspaceInviteRateLimiter {
  constructor(
    private readonly primary: WorkspaceInviteRateLimiter,
    private readonly fallback: WorkspaceInviteRateLimiter,
  ) {}

  async consume(workspaceId: string, email: string) {
    try {
      return await this.primary.consume(workspaceId, email);
    } catch {
      return this.fallback.consume(workspaceId, email);
    }
  }
}

export function createWorkspaceInviteRateLimiter({
  hashSecret,
  production,
  redisClient,
  redisUrl,
}: {
  hashSecret: string;
  production: boolean;
  redisClient?: RedisWorkspaceInviteRateLimitClient;
  redisUrl: string | undefined;
}): WorkspaceInviteRateLimiter {
  const url = redisUrl?.trim();
  if (!url && !redisClient) {
    return production
      ? new UnavailableWorkspaceInviteRateLimiter()
      : new InMemoryWorkspaceInviteRateLimiter();
  }

  const client = redisClient ?? createClient({
    socket: {
      connectTimeout: 1000,
      reconnectStrategy: false,
    },
    url,
  }) as RedisWorkspaceInviteRateLimitClient;
  client.on?.("error", () => undefined);

  const redisLimiter = new RedisWorkspaceInviteRateLimiter(client, hashSecret);
  return production
    ? redisLimiter
    : new DevelopmentFallbackWorkspaceInviteRateLimiter(
      redisLimiter,
      new InMemoryWorkspaceInviteRateLimiter(),
    );
}

function normalizeInput(workspaceId: string, email: string) {
  const normalizedWorkspaceId = workspaceId.trim();
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedWorkspaceId || !normalizedEmail) {
    throw new WorkspaceInviteRateLimitUnavailableError();
  }
  return { email: normalizedEmail, workspaceId: normalizedWorkspaceId };
}

function createRedisKey(
  scope: WorkspaceInviteRateLimitScope,
  identifier: string,
  hashSecret: string,
) {
  const hash = createHmac("sha256", hashSecret)
    .update(`${scope}:${identifier}`)
    .digest("hex");
  return `${REDIS_KEY_PREFIX}${scope}:${hash}`;
}

function parseRateLimitResult(response: unknown): WorkspaceInviteRateLimitResult {
  if (!Array.isArray(response) || response.length < 4) {
    throw new WorkspaceInviteRateLimitUnavailableError();
  }

  const workspace = { count: Number(response[0]), retryAfterMs: Number(response[1]) };
  const email = { count: Number(response[2]), retryAfterMs: Number(response[3]) };
  if (![workspace.count, workspace.retryAfterMs, email.count, email.retryAfterMs].every(Number.isFinite)) {
    throw new WorkspaceInviteRateLimitUnavailableError();
  }
  return toRateLimitResult(workspace, email);
}

function toRateLimitResult(
  workspace: { count: number; retryAfterMs: number },
  email: { count: number; retryAfterMs: number },
): WorkspaceInviteRateLimitResult {
  const workspaceBlocked = workspace.count > WORKSPACE_LIMIT;
  const emailBlocked = email.count > EMAIL_LIMIT;
  const scope = emailBlocked ? "email" : workspaceBlocked ? "workspace" : null;
  const retryAfterMs = scope === "email"
    ? email.retryAfterMs
    : scope === "workspace"
      ? workspace.retryAfterMs
      : Math.max(workspace.retryAfterMs, email.retryAfterMs);

  return {
    allowed: scope === null,
    retryAfterMs: Math.max(retryAfterMs, 0),
    scope,
  };
}
