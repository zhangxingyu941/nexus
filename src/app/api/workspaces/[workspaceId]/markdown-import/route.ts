import { documentServiceUnavailableResponse } from "@/app/api/documents/handlers";
import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { MarkdownDocumentTransferService } from "@/server/markdownDocumentTransferService";
import { createMarkdownImportRouteHandlers } from "./markdownImportRouteHandlers";

interface MarkdownImportRouteContext {
  params: Promise<{ workspaceId: string }>;
}

export async function POST(request: Request, context: MarkdownImportRouteContext) {
  if (!hasDatabaseConfiguration()) return documentServiceUnavailableResponse();
  const { workspaceId } = await context.params;
  const services = createPostgresServices();
  return createMarkdownImportRouteHandlers({
    authStore: services.authStore,
    transferService: new MarkdownDocumentTransferService({
      attachmentStore: services.attachmentStore,
      documentStore: services.documentStore,
      objectStorage: services.objectStorage,
    }),
  }).POST(request, workspaceId);
}
