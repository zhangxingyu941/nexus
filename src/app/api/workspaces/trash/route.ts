import { workspaceErrorResponse } from "@/app/api/workspaceErrorResponse";
import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { WorkspaceDomainError } from "@/server/workspaceErrors";
import { createWorkspaceLifecycleRouteHandlers } from "../lifecycleHandlers";

export async function GET(request: Request) {
  if (!hasDatabaseConfiguration()) return unavailableResponse();

  const services = createPostgresServices();
  return createWorkspaceLifecycleRouteHandlers({
    authStore: services.authStore,
    lifecycleStore: services.workspaceLifecycleStore,
    workspaceStore: services.workspaceStore,
  }).listTrash(request);
}

function unavailableResponse() {
  return workspaceErrorResponse(new WorkspaceDomainError(
    "service_unavailable",
    "Workspace lifecycle service is unavailable",
  ))!;
}
