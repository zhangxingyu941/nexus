import { workspaceErrorResponse } from "@/app/api/workspaceErrorResponse";
import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { WorkspaceDomainError } from "@/server/workspaceErrors";
import { createWorkspaceMemberRouteHandlers } from "../members/handlers";

interface WorkspaceLeaveRouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function POST(request: Request, context: WorkspaceLeaveRouteContext) {
  if (!hasDatabaseConfiguration()) return unavailableResponse();
  const { workspaceId } = await context.params;
  return createHandlers().leave(request, workspaceId);
}

function createHandlers() {
  const { authStore, workspaceMemberStore } = createPostgresServices();
  return createWorkspaceMemberRouteHandlers({
    authStore,
    memberStore: workspaceMemberStore,
  });
}

function unavailableResponse() {
  return workspaceErrorResponse(new WorkspaceDomainError(
    "service_unavailable",
    "Workspace member service is unavailable",
  ))!;
}
