import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { documentServiceUnavailableResponse } from "@/app/api/documents/handlers";
import { createWorkspaceDocumentRouteHandlers } from "./handlers";

interface WorkspaceDocumentRouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function POST(request: Request, context: WorkspaceDocumentRouteContext) {
  if (!hasDatabaseConfiguration()) return documentServiceUnavailableResponse();
  const { workspaceId } = await context.params;
  const { authStore, documentStore } = createPostgresServices();
  return createWorkspaceDocumentRouteHandlers({ authStore, documentStore }).POST(request, workspaceId);
}
