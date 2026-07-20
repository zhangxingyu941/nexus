import { workspaceErrorResponse } from "@/app/api/workspaceErrorResponse";
import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { WorkspaceDomainError } from "@/server/workspaceErrors";
import { createWorkspaceMemberRouteHandlers } from "../handlers";

interface WorkspaceMemberRouteContext {
  params: Promise<{ memberId: string; workspaceId: string }>;
}

export async function PATCH(request: Request, context: WorkspaceMemberRouteContext) {
  if (!hasDatabaseConfiguration()) return unavailableResponse();
  const { memberId, workspaceId } = await context.params;
  return createHandlers().PATCH(request, workspaceId, memberId);
}

export async function DELETE(request: Request, context: WorkspaceMemberRouteContext) {
  if (!hasDatabaseConfiguration()) return unavailableResponse();
  const { memberId, workspaceId } = await context.params;
  return createHandlers().DELETE(request, workspaceId, memberId);
}

function createHandlers() {
  const { authStore, workspaceMemberStore, workspaceStore } = createPostgresServices();
  return createWorkspaceMemberRouteHandlers({
    authStore,
    memberStore: workspaceMemberStore,
    workspaceStore,
  });
}

function unavailableResponse() {
  return workspaceErrorResponse(new WorkspaceDomainError(
    "service_unavailable",
    "Workspace member service is unavailable",
  ))!;
}
