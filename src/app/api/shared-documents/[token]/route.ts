import { createPostgresServices } from "../../../../server/applicationServices";
import { hasDatabaseConfiguration } from "../../../../server/database/pool";
import {
  createSharedDocumentHandlers,
  sharedServiceUnavailableResponse,
} from "../handlers";

interface SharedDocumentRouteContext {
  params: Promise<{ token: string }>;
}

export async function GET(_request: Request, context: SharedDocumentRouteContext) {
  if (!hasDatabaseConfiguration()) return sharedServiceUnavailableResponse();
  const { token } = await context.params;
  return createSharedDocumentHandlers({
    documentShareStore: createPostgresServices().documentShareStore,
  }).GET(token);
}
