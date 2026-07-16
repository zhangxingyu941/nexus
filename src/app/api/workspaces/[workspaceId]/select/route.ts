import { createPostgresServices } from "../../../../../server/applicationServices";
import { hasDatabaseConfiguration } from "../../../../../server/database/pool";
import {
  createWorkspaceRouteHandlers,
  workspaceServiceUnavailableResponse,
} from "../../handlers";

interface WorkspaceSelectionRouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function POST(request: Request, context: WorkspaceSelectionRouteContext) {
  if (!hasDatabaseConfiguration()) {
    return workspaceServiceUnavailableResponse();
  }

  const { workspaceId } = await context.params;
  return createWorkspaceRouteHandlers(createPostgresServices()).select(request, workspaceId);
}
