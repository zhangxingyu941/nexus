import { createPostgresServices } from "../../../server/applicationServices";
import { hasDatabaseConfiguration } from "../../../server/database/pool";
import {
  createWorkspaceRouteHandlers,
  workspaceServiceUnavailableResponse,
} from "./handlers";
import { scheduleWorkspacePurge } from "./purgeScheduler";

export async function GET(request: Request) {
  if (!hasDatabaseConfiguration()) {
    return workspaceServiceUnavailableResponse();
  }

  const services = createPostgresServices();
  const response = await createWorkspaceRouteHandlers(services).list(request);
  scheduleWorkspacePurge(() => services.workspacePurgeService.purgeExpired(3));
  return response;
}

export async function POST(request: Request) {
  if (!hasDatabaseConfiguration()) {
    return workspaceServiceUnavailableResponse();
  }

  return createWorkspaceRouteHandlers(createPostgresServices()).create(request);
}
