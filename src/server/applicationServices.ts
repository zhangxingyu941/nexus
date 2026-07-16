import type { Pool } from "pg";
import { getDatabasePool } from "./database/pool";
import { PostgresAuthStore } from "./postgresAuthStore";
import { PostgresWorkspaceInviteStore } from "./postgresWorkspaceInviteStore";
import { PostgresWorkspaceStore } from "./postgresWorkspaceStore";
import { getRedisSessionCache } from "./redisSessionCache";
import { WorkspaceInviteTokenService } from "./workspaceInviteTokens";

export function createPostgresServices(pool: Pool = getDatabasePool()) {
  const workspaceStore = new PostgresWorkspaceStore(pool);
  const workspaceInviteSecret = process.env.AUTH_HASH_SECRET?.trim()
    || (process.env.NODE_ENV === "production"
      ? ""
      : "development-only-workspace-invite-secret");
  const workspaceInviteStore = new PostgresWorkspaceInviteStore(pool, {
    tokenService: new WorkspaceInviteTokenService(workspaceInviteSecret),
  });
  const authStore = new PostgresAuthStore(pool, workspaceStore, {
    authCodeSecret: process.env.AUTH_HASH_SECRET,
    sessionCache: getRedisSessionCache(),
  });

  return { authStore, workspaceInviteStore, workspaceStore };
}
