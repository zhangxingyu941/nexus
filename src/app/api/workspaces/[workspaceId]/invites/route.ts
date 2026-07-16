import { workspaceErrorResponse } from "@/app/api/workspaceErrorResponse";
import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { WorkspaceDomainError } from "@/server/workspaceErrors";
import { createWorkspaceInviteRouteHandlers } from "./handlers";

interface WorkspaceInviteRouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function GET(request: Request, context: WorkspaceInviteRouteContext) {
  if (!hasDatabaseConfiguration()) return unavailableResponse();
  const { workspaceId } = await context.params;
  return createHandlers().GET(request, workspaceId);
}

export async function POST(request: Request, context: WorkspaceInviteRouteContext) {
  if (!hasDatabaseConfiguration()) return unavailableResponse();
  const { workspaceId } = await context.params;
  return createHandlers().POST(request, workspaceId);
}

function createHandlers() {
  const { authStore, workspaceInviteLimiter, workspaceInviteMailer, workspaceInviteStore } =
    createPostgresServices();
  return createWorkspaceInviteRouteHandlers({
    appUrl: process.env.APP_URL?.trim() || "http://localhost:3000",
    authStore,
    inviteStore: workspaceInviteStore,
    limiter: workspaceInviteLimiter,
    mailer: workspaceInviteMailer,
  });
}

function unavailableResponse() {
  return workspaceErrorResponse(new WorkspaceDomainError(
    "service_unavailable",
    "Workspace invitation service is unavailable",
  ))!;
}
