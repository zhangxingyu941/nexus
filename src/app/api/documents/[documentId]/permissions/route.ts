import { createPostgresServices } from "../../../../../server/applicationServices";
import { hasDatabaseConfiguration } from "../../../../../server/database/pool";
import {
  createDocumentRouteHandlers,
  documentServiceUnavailableResponse,
} from "../../handlers";

interface DocumentPermissionRouteContext {
  params: Promise<{ documentId: string }>;
}

export async function GET(request: Request, context: DocumentPermissionRouteContext) {
  if (!hasDatabaseConfiguration()) {
    return documentServiceUnavailableResponse();
  }

  const { documentId } = await context.params;
  const services = createPostgresServices();
  return createDocumentRouteHandlers({
    authStore: services.authStore,
    documentStore: services.documentStore,
  }).GETPermissions(request, documentId);
}

export async function PATCH(request: Request, context: DocumentPermissionRouteContext) {
  if (!hasDatabaseConfiguration()) {
    return documentServiceUnavailableResponse();
  }

  const { documentId } = await context.params;
  const services = createPostgresServices();
  return createDocumentRouteHandlers({
    authStore: services.authStore,
    documentStore: services.documentStore,
  }).PATCHPermissions(request, documentId);
}
