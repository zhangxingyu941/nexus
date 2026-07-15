import { NextResponse } from "next/server";
import { createPostgresServices } from "../../../../server/applicationServices";
import { getAuthCredentialDecryptor } from "../../../../server/authCredentialServices";
import { hasDatabaseConfiguration } from "../../../../server/database/pool";
import { getAuthRequestSecurity } from "../../../../server/authRequestSecurity";
import {
  createDeleteSessionRouteHandler,
  createGetSessionRouteHandler,
  createSessionRouteHandlers,
} from "./handlers";

export async function GET(request: Request) {
  if (!hasDatabaseConfiguration()) {
    return NextResponse.json({ mode: "local", user: null });
  }

  const { authStore } = createPostgresServices();
  return createGetSessionRouteHandler(authStore)(request);
}

export async function POST(request: Request) {
  if (!hasDatabaseConfiguration()) {
    return NextResponse.json({ error: "当前未启用 PostgreSQL 模式" }, { status: 503 });
  }

  const { authStore } = createPostgresServices();
  return createSessionRouteHandlers(
    authStore,
    getAuthRequestSecurity(authStore),
    getAuthCredentialDecryptor(),
  ).POST(request);
}

export async function DELETE(request: Request) {
  if (!hasDatabaseConfiguration()) {
    return new NextResponse(null, { status: 204 });
  }

  const { authStore } = createPostgresServices();
  return createDeleteSessionRouteHandler(authStore)(request);
}
