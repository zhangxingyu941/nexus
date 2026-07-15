import { createPostgresServices } from "../../../server/applicationServices";
import { hasDatabaseConfiguration } from "../../../server/database/pool";
import {
  createWorkspaceRouteHandlers,
  workspaceServiceUnavailableResponse,
} from "./handlers";

export async function GET(request: Request) {
  if (!hasDatabaseConfiguration()) {
    return workspaceServiceUnavailableResponse();
  }

  return createWorkspaceRouteHandlers(createPostgresServices()).list(request);
}

export async function POST(request: Request) {
  if (!hasDatabaseConfiguration()) {
    return workspaceServiceUnavailableResponse();
  }

  return createWorkspaceRouteHandlers(createPostgresServices()).create(request);
}
