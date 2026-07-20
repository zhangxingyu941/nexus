import { workspaceErrorResponse } from "@/app/api/workspaceErrorResponse";
import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { WorkspaceDomainError } from "@/server/workspaceErrors";
import { createWorkspaceLifecycleRouteHandlers } from "../../lifecycleHandlers";

interface WorkspaceRestoreRouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function POST(request: Request, context: WorkspaceRestoreRouteContext) {
  if (!hasDatabaseConfiguration()) return unavailableResponse();

  const { workspaceId } = await context.params;
  const services = createPostgresServices();
  return createWorkspaceLifecycleRouteHandlers({
    authStore: services.authStore,
    lifecycleStore: services.workspaceLifecycleStore,
    workspaceStore: services.workspaceStore,
  }).restore(request, workspaceId);
}

function unavailableResponse() {
  return workspaceErrorResponse(new WorkspaceDomainError(
    "service_unavailable",
    "Workspace lifecycle service is unavailable",
  ))!;
}
