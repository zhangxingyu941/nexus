import { NextResponse } from "next/server";
import { createPostgresServices } from "../../../../../server/applicationServices";
import { hasDatabaseConfiguration } from "../../../../../server/database/pool";
import { getAuthRequestSecurity } from "../../../../../server/authRequestSecurity";
import { createResetPasswordRouteHandler } from "./handlers";

export async function POST(request: Request) {
  if (!hasDatabaseConfiguration()) {
    return NextResponse.json({ error: "当前未启用 PostgreSQL 模式" }, { status: 503 });
  }
  const { authStore } = createPostgresServices();
  return createResetPasswordRouteHandler(authStore, getAuthRequestSecurity(authStore))(request);
}
