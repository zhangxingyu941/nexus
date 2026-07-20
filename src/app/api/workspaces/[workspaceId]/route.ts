import { createPostgresServices } from "../../../../server/applicationServices";
import { hasDatabaseConfiguration } from "../../../../server/database/pool";
import {
  createWorkspaceRouteHandlers,
  workspaceServiceUnavailableResponse,
} from "../handlers";
import { createWorkspaceLifecycleRouteHandlers } from "../lifecycleHandlers";

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

export async function DELETE(request: Request, context: WorkspaceRouteContext) {
  if (!hasDatabaseConfiguration()) {
    return workspaceServiceUnavailableResponse();
  }

  const { workspaceId } = await context.params;
  const services = createPostgresServices();
  return createWorkspaceLifecycleRouteHandlers({
    authStore: services.authStore,
    lifecycleStore: services.workspaceLifecycleStore,
    workspaceStore: services.workspaceStore,
  }).DELETE(request, workspaceId);
}
