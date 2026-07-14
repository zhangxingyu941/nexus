import type { Pool } from "pg";
import { getDatabasePool } from "./database/pool";
import { PostgresAuthStore } from "./postgresAuthStore";
import { PostgresWorkspaceStore } from "./postgresWorkspaceStore";
import { getRedisSessionCache } from "./redisSessionCache";

export function createPostgresServices(pool: Pool = getDatabasePool()) {
  const workspaceStore = new PostgresWorkspaceStore(pool);
  const authStore = new PostgresAuthStore(pool, workspaceStore, {
    authCodeSecret: process.env.AUTH_HASH_SECRET,
    sessionCache: getRedisSessionCache(),
  });

  return { authStore, workspaceStore };
}
