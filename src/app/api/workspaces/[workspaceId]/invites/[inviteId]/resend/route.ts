import { workspaceErrorResponse } from "@/app/api/workspaceErrorResponse";
import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { WorkspaceDomainError } from "@/server/workspaceErrors";
import { createWorkspaceInviteRouteHandlers } from "../../handlers";

interface WorkspaceInviteResendRouteContext {
  params: Promise<{ inviteId: string; workspaceId: string }>;
}

export async function POST(request: Request, context: WorkspaceInviteResendRouteContext) {
  if (!hasDatabaseConfiguration()) return unavailableResponse();
  const { inviteId, workspaceId } = await context.params;
  return createHandlers().resend(request, workspaceId, inviteId);
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
