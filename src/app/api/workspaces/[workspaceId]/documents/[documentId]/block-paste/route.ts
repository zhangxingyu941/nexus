import { documentServiceUnavailableResponse } from "@/app/api/documents/handlers";
import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { createBlockClipboardPasteRouteHandlers } from "./blockClipboardPasteRouteHandlers";

interface BlockClipboardPasteRouteContext {
  params: Promise<{ documentId: string; workspaceId: string }>;
}

export async function POST(request: Request, context: BlockClipboardPasteRouteContext) {
  if (!hasDatabaseConfiguration()) return documentServiceUnavailableResponse();
  const { documentId, workspaceId } = await context.params;
  const services = createPostgresServices();
  return createBlockClipboardPasteRouteHandlers({
    authStore: services.authStore,
    pasteService: services.blockClipboardPasteService,
  }).POST(request, workspaceId, documentId);
}
