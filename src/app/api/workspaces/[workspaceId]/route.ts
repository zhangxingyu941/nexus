import { createPostgresServices } from "../../../../server/applicationServices";
import { hasDatabaseConfiguration } from "../../../../server/database/pool";
import {
  createWorkspaceRouteHandlers,
  workspaceServiceUnavailableResponse,
} from "../handlers";

interface WorkspaceRouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function GET(request: Request, context: WorkspaceRouteContext) {
  if (!hasDatabaseConfiguration()) {
    return workspaceServiceUnavailableResponse();
  }

  const { workspaceId } = await context.params;
  return createWorkspaceRouteHandlers(createPostgresServices()).load(request, workspaceId);
}

export async function PATCH(request: Request, context: WorkspaceRouteContext) {
  if (!hasDatabaseConfiguration()) {
    return workspaceServiceUnavailableResponse();
  }

  const { workspaceId } = await context.params;
  return createWorkspaceRouteHandlers(createPostgresServices()).rename(request, workspaceId);
}

export async function PUT(request: Request, context: WorkspaceRouteContext) {
  if (!hasDatabaseConfiguration()) {
    return workspaceServiceUnavailableResponse();
  }

  const { workspaceId } = await context.params;
  return createWorkspaceRouteHandlers(createPostgresServices()).save(request, workspaceId);
}
