import { documentServiceUnavailableResponse } from "@/app/api/documents/handlers";
import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { MarkdownDocumentTransferService } from "@/server/markdownDocumentTransferService";
import { createMarkdownExportRouteHandlers } from "./markdownExportRouteHandlers";

interface MarkdownExportRouteContext {
  params: Promise<{ documentId: string; workspaceId: string }>;
}

export async function GET(request: Request, context: MarkdownExportRouteContext) {
  if (!hasDatabaseConfiguration()) return documentServiceUnavailableResponse();
  const { documentId, workspaceId } = await context.params;
  const services = createPostgresServices();
  return createMarkdownExportRouteHandlers({
    authStore: services.authStore,
    transferService: new MarkdownDocumentTransferService({
      attachmentStore: services.attachmentStore,
      documentStore: services.documentStore,
      objectStorage: services.objectStorage,
    }),
  }).GET(request, workspaceId, documentId);
}
