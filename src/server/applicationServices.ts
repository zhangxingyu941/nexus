import type { Pool } from "pg";
import { getDatabasePool } from "./database/pool";
import {
  DocumentAuthorizationService,
  PostgresDocumentAuthorizationRecords,
} from "./documentAuthorization";
import { PostgresAuthStore } from "./postgresAuthStore";
import { PostgresWorkspaceInviteStore } from "./postgresWorkspaceInviteStore";
import { PostgresWorkspaceLifecycleStore } from "./postgresWorkspaceLifecycleStore";
import { PostgresWorkspaceMemberStore } from "./postgresWorkspaceMemberStore";
import { PostgresWorkspaceStore } from "./postgresWorkspaceStore";
import { getRedisSessionCache } from "./redisSessionCache";
import { createObjectStorage } from "./objectStorage";
import { createWorkspaceInviteMailerFromEnvironment } from "./workspaceInviteMailer";
import { createWorkspaceInviteRateLimiter } from "./workspaceInviteRateLimiter";
import type { WorkspaceInviteRateLimiter } from "./workspaceInviteRateLimiter";
import { WorkspaceInviteTokenService } from "./workspaceInviteTokens";
import { WorkspacePurgeService } from "./workspacePurgeService";

let workspaceInviteLimiter: WorkspaceInviteRateLimiter | null = null;

export function createPostgresServices(pool: Pool = getDatabasePool()) {
  const workspaceStore = new PostgresWorkspaceStore(pool);
  const documentAuthorization = new DocumentAuthorizationService(
    new PostgresDocumentAuthorizationRecords(pool),
  );
  const production = process.env.NODE_ENV === "production";
  const workspaceInviteSecret = process.env.AUTH_HASH_SECRET?.trim()
    || (production
      ? ""
      : "development-only-workspace-invite-secret");
  const workspaceInviteTokenService = new WorkspaceInviteTokenService(workspaceInviteSecret);
  const workspaceInviteStore = new PostgresWorkspaceInviteStore(pool, {
    tokenService: workspaceInviteTokenService,
  });
  const workspaceMemberStore = new PostgresWorkspaceMemberStore(pool);
  const workspaceLifecycleStore = new PostgresWorkspaceLifecycleStore(pool);
  const workspacePurgeService = new WorkspacePurgeService({
    lifecycleStore: workspaceLifecycleStore,
    objectStorage: createObjectStorage(),
  });
  const authStore = new PostgresAuthStore(pool, workspaceStore, {
    authCodeSecret: process.env.AUTH_HASH_SECRET,
    sessionCache: getRedisSessionCache(),
  });
  workspaceInviteLimiter ??= createWorkspaceInviteRateLimiter({
    hashSecret: workspaceInviteSecret,
    production,
    redisUrl: process.env.REDIS_URL,
  });
  const workspaceInviteMailer = createWorkspaceInviteMailerFromEnvironment();

  return {
    authStore,
    documentAuthorization,
    workspaceInviteLimiter,
    workspaceInviteMailer,
    workspaceInviteStore,
    workspaceInviteTokenService,
    workspaceLifecycleStore,
    workspaceMemberStore,
    workspacePurgeService,
    workspaceStore,
  };
}
