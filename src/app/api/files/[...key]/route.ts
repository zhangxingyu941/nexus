import { createPostgresServices } from "../../../../server/applicationServices";
import { hasDatabaseConfiguration } from "../../../../server/database/pool";
import { createObjectStorage } from "../../../../server/objectStorage";
import { createFileRouteHandlers } from "../handlers";

interface FileRouteContext {
  params: Promise<{ key: string[] }>;
}

export async function GET(request: Request, context: FileRouteContext) {
  const objectStorage = createObjectStorage();
  const { key } = await context.params;
  const objectKey = key.join("/");

  if (hasDatabaseConfiguration()) {
    return createFileRouteHandlers({ ...createPostgresServices(), objectStorage }).GET(request, objectKey);
  }

  return createFileRouteHandlers({ objectStorage }).GET(request, objectKey);
}
