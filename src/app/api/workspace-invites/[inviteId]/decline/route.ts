import { workspaceErrorResponse } from "@/app/api/workspaceErrorResponse";
import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { WorkspaceDomainError } from "@/server/workspaceErrors";
import { createWorkspaceInviteRecipientRouteHandlers } from "../../handlers";

interface InviteRouteContext {
  params: Promise<{ inviteId: string }>;
}

export async function POST(request: Request, context: InviteRouteContext) {
  if (!hasDatabaseConfiguration()) return unavailableResponse();
  const { inviteId } = await context.params;
  return createHandlers().declineById(request, inviteId);
}

function createHandlers() {
  const {
    authStore,
    workspaceInviteStore: inviteStore,
    workspaceInviteTokenService: tokenService,
    workspaceStore,
  } = createPostgresServices();
  return createWorkspaceInviteRecipientRouteHandlers({
    authStore,
    inviteStore,
    tokenService,
    workspaceStore,
  });
}

function unavailableResponse() {
  return workspaceErrorResponse(new WorkspaceDomainError(
    "service_unavailable",
    "Workspace invitation service is unavailable",
  ))!;
}
