import { NextResponse } from "next/server";
import {
  getOAuthCookieOptions,
  GITHUB_OAUTH_STATE_COOKIE,
  GITHUB_OAUTH_VERIFIER_COOKIE,
} from "./oauthCookies";

interface GitHubOAuthStarter {
  createAuthorization(): { codeVerifier: string; state: string; url: string };
}

export function createGitHubStartRouteHandler(oauth: GitHubOAuthStarter) {
  return async (_request: Request) => {
    const transaction = oauth.createAuthorization();
    const response = NextResponse.redirect(transaction.url);
    response.cookies.set(
      GITHUB_OAUTH_STATE_COOKIE,
      transaction.state,
      getOAuthCookieOptions(),
    );
    response.cookies.set(
      GITHUB_OAUTH_VERIFIER_COOKIE,
      transaction.codeVerifier,
      getOAuthCookieOptions(),
    );
    return response;
  };
}
