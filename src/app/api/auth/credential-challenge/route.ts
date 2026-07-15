import { NextResponse } from "next/server";
import { createPostgresServices } from "../../../../server/applicationServices";
import { getAuthCredentialService } from "../../../../server/authCredentialServices";
import { getAuthRequestSecurity } from "../../../../server/authRequestSecurity";
import { hasDatabaseConfiguration } from "../../../../server/database/pool";
import { authCredentialServiceUnavailableResponse } from "../authCredentialResponse";
import { createCredentialChallengeRouteHandler } from "./handlers";

export async function POST(request: Request) {
  if (!hasDatabaseConfiguration()) {
    return withNoStore(NextResponse.json(
      { error: "当前未启用 PostgreSQL 模式" },
      { status: 503 },
    ));
  }

  try {
    const { authStore } = createPostgresServices();
    const credentials = await getAuthCredentialService();
    const security = getAuthRequestSecurity(authStore);
    return withNoStore(await createCredentialChallengeRouteHandler({
      credentials,
      security,
    })(request));
  } catch {
    return withNoStore(authCredentialServiceUnavailableResponse());
  }
}

function withNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store");
  return response;
}
