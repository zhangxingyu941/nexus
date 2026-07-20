import { NextResponse } from "next/server";
import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { createDocumentHistoryRouteHandlers } from "./handlers";

interface DocumentHistoryRouteContext {
  params: Promise<{ documentId: string; workspaceId: string }>;
}

function unavailableResponse() {
  return NextResponse.json({ error: "历史版本需要启用 PostgreSQL 模式" }, { status: 503 });
}

export async function GET(request: Request, context: DocumentHistoryRouteContext) {
  if (!hasDatabaseConfiguration()) return unavailableResponse();
  const { documentId, workspaceId } = await context.params;
  const services = createPostgresServices();
  return createDocumentHistoryRouteHandlers({
    authStore: services.authStore,
    documentAuthorization: services.documentAuthorization,
    workspaceStore: services.workspaceStore,
  }).GET(
    request,
    workspaceId,
    documentId,
  );
}

export async function POST(request: Request, context: DocumentHistoryRouteContext) {
  if (!hasDatabaseConfiguration()) return unavailableResponse();
  const { documentId, workspaceId } = await context.params;
  const services = createPostgresServices();
  return createDocumentHistoryRouteHandlers({
    authStore: services.authStore,
    documentAuthorization: services.documentAuthorization,
    workspaceStore: services.workspaceStore,
  }).POST(
    request,
    workspaceId,
    documentId,
  );
}
