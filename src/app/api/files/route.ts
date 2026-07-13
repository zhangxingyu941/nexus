import { createPostgresServices } from "../../../server/applicationServices";
import { hasDatabaseConfiguration } from "../../../server/database/pool";
import { createObjectStorage } from "../../../server/objectStorage";
import { createFileRouteHandlers } from "./handlers";

export async function POST(request: Request) {
  const objectStorage = createObjectStorage();

  if (hasDatabaseConfiguration()) {
    return createFileRouteHandlers({ ...createPostgresServices(), objectStorage }).POST(request);
  }

  return createFileRouteHandlers({ objectStorage }).POST(request);
}
