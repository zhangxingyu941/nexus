import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { documentServiceUnavailableResponse } from "@/app/api/documents/handlers";
import { createWorkspaceDocumentRouteHandlers } from "../handlers";

interface WorkspaceDocumentItemRouteContext {
  params: Promise<{ documentId: string; workspaceId: string }>;
}

export async function DELETE(request: Request, context: WorkspaceDocumentItemRouteContext) {
  if (!hasDatabaseConfiguration()) return documentServiceUnavailableResponse();
  const { documentId, workspaceId } = await context.params;
  const { authStore, documentStore } = createPostgresServices();
  return createWorkspaceDocumentRouteHandlers({ authStore, documentStore }).DELETE(
    request,
    workspaceId,
    documentId,
  );
}
