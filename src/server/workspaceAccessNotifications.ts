import { EventEmitter } from "node:events";
import type { Pool, PoolClient } from "pg";

export interface WorkspaceAccessInvalidation {
  workspaceId: string;
  userId: string | null;
}

export interface WorkspaceAccessInvalidationSource {
  on(event: "invalidation", listener: (event: WorkspaceAccessInvalidation) => void): void;
  removeAllListeners(): void;
}

export function notifyWorkspaceAccessInvalidation(
  client: Pick<PoolClient, "query">,
  event: WorkspaceAccessInvalidation,
) {
  return client.query("SELECT pg_notify($1,$2)", [
    "workspace_access_invalidated",
    JSON.stringify(event),
  ]);
}

export class PostgresWorkspaceAccessListener implements WorkspaceAccessInvalidationSource {
  private client: PoolClient | null = null;
  private readonly emitter: EventEmitter;

  constructor(private readonly pool: Pool) {
    this.emitter = new EventEmitter();
  }

  async start(): Promise<void> {
    this.client = await this.pool.connect();
    await this.client.query("LISTEN workspace_access_invalidated");
    this.client.on("notification", (message) => {
      try {
        const event = JSON.parse(message.payload ?? "{}") as WorkspaceAccessInvalidation;
        this.emitter.emit("invalidation", event);
      } catch {
        // Ignore malformed notifications
      }
    });
  }

  on(event: "invalidation", listener: (event: WorkspaceAccessInvalidation) => void) {
    this.emitter.on(event, listener);
  }

  removeAllListeners() {
    this.emitter.removeAllListeners();
  }

  async stop(): Promise<void> {
    this.removeAllListeners();
    if (this.client) {
      await this.client.query("UNLISTEN workspace_access_invalidated");
      this.client.release();
      this.client = null;
    }
  }
}

export type { EventEmitter };
