import { workspaceErrorResponse } from "@/app/api/workspaceErrorResponse";
import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { WorkspaceDomainError } from "@/server/workspaceErrors";
import { createWorkspaceLifecycleRouteHandlers } from "../lifecycleHandlers";
import { scheduleWorkspacePurge } from "../purgeScheduler";

export async function GET(request: Request) {
  if (!hasDatabaseConfiguration()) return unavailableResponse();

  const services = createPostgresServices();
  const response = await createWorkspaceLifecycleRouteHandlers({
    authStore: services.authStore,
    lifecycleStore: services.workspaceLifecycleStore,
    workspaceStore: services.workspaceStore,
  }).listTrash(request);
  scheduleWorkspacePurge(() => services.workspacePurgeService.purgeExpired(3));
  return response;
}

function unavailableResponse() {
  return workspaceErrorResponse(new WorkspaceDomainError(
    "service_unavailable",
    "Workspace lifecycle service is unavailable",
  ))!;
}
