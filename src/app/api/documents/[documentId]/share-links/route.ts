import { createPostgresServices } from "../../../../../server/applicationServices";
import { hasDatabaseConfiguration } from "../../../../../server/database/pool";
import {
  createDocumentShareLinkHandlers,
  documentShareServiceUnavailableResponse,
} from "../../../document-share-links/handlers";

interface DocumentShareLinkRouteContext {
  params: Promise<{ documentId: string }>;
}

function createHandlers() {
  const services = createPostgresServices();
  return createDocumentShareLinkHandlers({
    authStore: services.authStore,
    documentShareStore: services.documentShareStore,
  });
}

export async function GET(request: Request, context: DocumentShareLinkRouteContext) {
  if (!hasDatabaseConfiguration()) return documentShareServiceUnavailableResponse();
  const { documentId } = await context.params;
  return createHandlers().GET(request, documentId);
}

export async function POST(request: Request, context: DocumentShareLinkRouteContext) {
  if (!hasDatabaseConfiguration()) return documentShareServiceUnavailableResponse();
  const { documentId } = await context.params;
  return createHandlers().POST(request, documentId);
}

export async function DELETE(request: Request, context: DocumentShareLinkRouteContext) {
  if (!hasDatabaseConfiguration()) return documentShareServiceUnavailableResponse();
  const { documentId } = await context.params;
  return createHandlers().DELETE(request, documentId);
}
