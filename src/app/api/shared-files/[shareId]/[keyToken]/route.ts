import { createPostgresServices } from "../../../../../server/applicationServices";
import { hasDatabaseConfiguration } from "../../../../../server/database/pool";
import {
  createSharedFileHandlers,
  sharedFileServiceUnavailableResponse,
} from "../../handlers";

interface SharedFileRouteContext {
  params: Promise<{ keyToken: string; shareId: string }>;
}

export async function GET(request: Request, context: SharedFileRouteContext) {
  if (!hasDatabaseConfiguration()) return sharedFileServiceUnavailableResponse();
  const parameters = await context.params;
  return createSharedFileHandlers({
    documentShareStore: createPostgresServices().documentShareStore,
  }).GET(request, parameters);
}
