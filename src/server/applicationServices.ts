import type { Pool } from "pg";
import { getDatabasePool } from "./database/pool";
import { PostgresAuthStore } from "./postgresAuthStore";
import { PostgresWorkspaceInviteStore } from "./postgresWorkspaceInviteStore";
import { PostgresWorkspaceStore } from "./postgresWorkspaceStore";
import { getRedisSessionCache } from "./redisSessionCache";
import { createWorkspaceInviteMailerFromEnvironment } from "./workspaceInviteMailer";
import { createWorkspaceInviteRateLimiter } from "./workspaceInviteRateLimiter";
import { WorkspaceInviteTokenService } from "./workspaceInviteTokens";

export function createPostgresServices(pool: Pool = getDatabasePool()) {
  const workspaceStore = new PostgresWorkspaceStore(pool);
  const production = process.env.NODE_ENV === "production";
  const workspaceInviteSecret = process.env.AUTH_HASH_SECRET?.trim()
    || (production
      ? ""
      : "development-only-workspace-invite-secret");
  const workspaceInviteStore = new PostgresWorkspaceInviteStore(pool, {
    tokenService: new WorkspaceInviteTokenService(workspaceInviteSecret),
  });
  const authStore = new PostgresAuthStore(pool, workspaceStore, {
    authCodeSecret: process.env.AUTH_HASH_SECRET,
    sessionCache: getRedisSessionCache(),
  });
  const workspaceInviteLimiter = createWorkspaceInviteRateLimiter({
    hashSecret: workspaceInviteSecret,
    production,
    redisUrl: process.env.REDIS_URL,
  });
  const workspaceInviteMailer = createWorkspaceInviteMailerFromEnvironment();

  return {
    authStore,
    workspaceInviteLimiter,
    workspaceInviteMailer,
    workspaceInviteStore,
    workspaceStore,
  };
}
