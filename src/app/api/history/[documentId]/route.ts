import { NextResponse } from "next/server";
import { createPostgresServices } from "../../../../server/applicationServices";
import { hasDatabaseConfiguration } from "../../../../server/database/pool";
import { createDocumentHistoryRouteHandlers } from "./handlers";

interface DocumentHistoryRouteContext {
  params: Promise<{ documentId: string }>;
}

function unavailableResponse() {
  return NextResponse.json({ error: "历史版本需要启用 PostgreSQL 模式" }, { status: 503 });
}

export async function GET(request: Request, context: DocumentHistoryRouteContext) {
  if (!hasDatabaseConfiguration()) {
    return unavailableResponse();
  }

  const { documentId } = await context.params;
  return createDocumentHistoryRouteHandlers(createPostgresServices()).GET(request, documentId);
}

export async function POST(request: Request, context: DocumentHistoryRouteContext) {
  if (!hasDatabaseConfiguration()) {
    return unavailableResponse();
  }

  const { documentId } = await context.params;
  return createDocumentHistoryRouteHandlers(createPostgresServices()).POST(request, documentId);
}
