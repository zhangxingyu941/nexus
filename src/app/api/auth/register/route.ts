import { NextResponse } from "next/server";
import { createPostgresServices } from "../../../../server/applicationServices";
import { getAuthCredentialDecryptor } from "../../../../server/authCredentialServices";
import { hasDatabaseConfiguration } from "../../../../server/database/pool";
import { getAuthRequestSecurity } from "../../../../server/authRequestSecurity";
import { resolveAuthMailer } from "../authMailerResponse";
import { createRegisterRouteHandler } from "./handlers";

export async function POST(request: Request) {
  if (!hasDatabaseConfiguration()) {
    return NextResponse.json({ error: "当前未启用 PostgreSQL 模式" }, { status: 503 });
  }

  const mailerResolution = resolveAuthMailer();
  if (!mailerResolution.ok) {
    return mailerResolution.response;
  }

  const { authStore } = createPostgresServices();
  return createRegisterRouteHandler({
    authStore,
    credentials: getAuthCredentialDecryptor(),
    mailer: mailerResolution.mailer,
    security: getAuthRequestSecurity(authStore),
  })(request);
}
