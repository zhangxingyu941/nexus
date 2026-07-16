import { NextResponse } from "next/server";
import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { createWorkspaceMemberRouteHandlers } from "./handlers";

interface WorkspaceMemberRouteContext {
  params: Promise<{ workspaceId: string }>;
}

function unavailableResponse() {
  return NextResponse.json({ error: "当前未启用 PostgreSQL 模式" }, { status: 503 });
}

export async function GET(request: Request, context: WorkspaceMemberRouteContext) {
  if (!hasDatabaseConfiguration()) return unavailableResponse();
  const { workspaceId } = await context.params;
  return createWorkspaceMemberRouteHandlers(createPostgresServices()).GET(request, workspaceId);
}

export async function POST(request: Request, context: WorkspaceMemberRouteContext) {
  if (!hasDatabaseConfiguration()) return unavailableResponse();
  const { workspaceId } = await context.params;
  return createWorkspaceMemberRouteHandlers(createPostgresServices()).POST(request, workspaceId);
}
