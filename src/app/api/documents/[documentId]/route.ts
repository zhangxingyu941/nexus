import { createPostgresServices } from "../../../../server/applicationServices";
import { hasDatabaseConfiguration } from "../../../../server/database/pool";
import {
  createDocumentRouteHandlers,
  documentServiceUnavailableResponse,
} from "../handlers";

interface DocumentRouteContext {
  params: Promise<{ documentId: string }>;
}

export async function GET(request: Request, context: DocumentRouteContext) {
  if (!hasDatabaseConfiguration()) {
    return documentServiceUnavailableResponse();
  }

  const { documentId } = await context.params;
  const services = createPostgresServices();
  return createDocumentRouteHandlers({
    authStore: services.authStore,
    documentStore: services.documentStore,
  }).GET(request, documentId);
}

export async function PUT(request: Request, context: DocumentRouteContext) {
  if (!hasDatabaseConfiguration()) {
    return documentServiceUnavailableResponse();
  }

  const { documentId } = await context.params;
  const services = createPostgresServices();
  return createDocumentRouteHandlers({
    authStore: services.authStore,
    documentStore: services.documentStore,
  }).PUT(request, documentId);
}
