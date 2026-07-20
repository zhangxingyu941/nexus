import { workspaceErrorResponse } from "@/app/api/workspaceErrorResponse";
import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { WorkspaceDomainError } from "@/server/workspaceErrors";
import { createWorkspaceMemberRouteHandlers } from "./handlers";

interface WorkspaceMemberRouteContext {
  params: Promise<{ workspaceId: string }>;
}

function unavailableResponse() {
  return workspaceErrorResponse(new WorkspaceDomainError(
    "service_unavailable",
    "Workspace member service is unavailable",
  ))!;
}

export async function GET(request: Request, context: WorkspaceMemberRouteContext) {
  if (!hasDatabaseConfiguration()) return unavailableResponse();
  const { workspaceId } = await context.params;
  const { authStore, workspaceMemberStore, workspaceStore } = createPostgresServices();
  return createWorkspaceMemberRouteHandlers({
    authStore,
    memberStore: workspaceMemberStore,
    workspaceStore,
  }).GET(request, workspaceId);
}
