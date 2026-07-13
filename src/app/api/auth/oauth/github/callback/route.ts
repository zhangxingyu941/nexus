import { NextResponse } from "next/server";
import { createPostgresServices } from "../../../../../../server/applicationServices";
import { createGitHubOAuthService } from "../../../../../../server/githubOAuth";
import { getAuthRequestSecurity } from "../../../../../../server/authRequestSecurity";
import { createGitHubCallbackRouteHandler } from "./handlers";

export async function GET(request: Request) {
  const oauth = createGitHubOAuthService();
  if (!oauth) {
    return NextResponse.redirect(new URL("/?oauth=failed", request.url));
  }
  const { authStore } = createPostgresServices();
  return createGitHubCallbackRouteHandler({
    authStore,
    oauth,
    security: getAuthRequestSecurity(authStore),
  })(request);
}
