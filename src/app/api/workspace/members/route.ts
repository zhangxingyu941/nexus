import { NextResponse } from "next/server";
import { createPostgresServices } from "../../../../server/applicationServices";
import { hasDatabaseConfiguration } from "../../../../server/database/pool";
import { createWorkspaceMemberRouteHandlers } from "./handlers";

function unavailableResponse() {
  return NextResponse.json({ error: "当前未启用 PostgreSQL 模式" }, { status: 503 });
}

export async function GET(request: Request) {
  if (!hasDatabaseConfiguration()) {
    return unavailableResponse();
  }

  return createWorkspaceMemberRouteHandlers(createPostgresServices()).GET(request);
}

export async function POST(request: Request) {
  if (!hasDatabaseConfiguration()) {
    return unavailableResponse();
  }

  return createWorkspaceMemberRouteHandlers(createPostgresServices()).POST(request);
}
