import { workspaceErrorResponse } from "@/app/api/workspaceErrorResponse";
import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { WorkspaceDomainError } from "@/server/workspaceErrors";
import { createWorkspaceInviteRecipientRouteHandlers } from "./handlers";

export async function GET(request: Request) {
  if (!hasDatabaseConfiguration()) return unavailableResponse();
  return createHandlers().list(request);
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
