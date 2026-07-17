import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { GitHubOAuthProfile } from "../../../../../../server/githubOAuth";
import type { CreatedSession } from "../../../../../../server/postgresAuthStore";
import { getCookieValue, getSessionCookieOptions, SESSION_COOKIE_NAME } from "../../../../../../server/sessionCookie";
import {
  getOAuthCookieOptions,
  GITHUB_OAUTH_RETURN_TO_COOKIE,
  GITHUB_OAUTH_STATE_COOKIE,
  GITHUB_OAUTH_VERIFIER_COOKIE,
  normalizeOAuthReturnTo,
} from "../oauthCookies";
import { enforceAuthRateLimit, recordAuthAudit, type RouteAuthSecurity } from "../../../authSecurity";

interface GitHubOAuthCallbackService {
  exchange(code: string, codeVerifier: string): Promise<GitHubOAuthProfile>;
}

interface OAuthAuthStore {
  loginWithOAuth(profile: GitHubOAuthProfile): Promise<CreatedSession>;
}

export function createGitHubCallbackRouteHandler({
  authStore,
  oauth,
  security,
}: {
  authStore: OAuthAuthStore;
  oauth: GitHubOAuthCallbackService;
  security: RouteAuthSecurity;
}) {
  return async (request: Request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const expectedState = getCookieValue(request, GITHUB_OAUTH_STATE_COOKIE);
    const codeVerifier = getCookieValue(request, GITHUB_OAUTH_VERIFIER_COOKIE);
    const returnTo = normalizeOAuthReturnTo(
      getCookieValue(request, GITHUB_OAUTH_RETURN_TO_COOKIE),
    );
    const limitedResponse = await enforceAuthRateLimit(security, request, "github-callback", state);
    if (limitedResponse) {
      return clearOAuthCookies(limitedResponse);
    }

    if (!code || !codeVerifier || !safeEquals(state, expectedState)) {
      await recordAuthAudit(security, request, "github-oauth", false, null);
      return clearOAuthCookies(NextResponse.redirect(new URL("/?oauth=failed", url.origin)));
    }

    try {
      const profile = await oauth.exchange(code, codeVerifier);
      const session = await authStore.loginWithOAuth(profile);
      await security.reset(request, "github-callback", state);
      await recordAuthAudit(security, request, "github-oauth", true, session.user.id);
      const response = NextResponse.redirect(new URL(returnTo, url.origin));
      response.cookies.set(SESSION_COOKIE_NAME, session.token, getSessionCookieOptions(session.expiresAt));
      return clearOAuthCookies(response);
    } catch {
      await recordAuthAudit(security, request, "github-oauth", false, null);
      return clearOAuthCookies(NextResponse.redirect(new URL("/?oauth=failed", url.origin)));
    }
  };
}

function clearOAuthCookies(response: NextResponse) {
  const options = getOAuthCookieOptions(0);
  response.cookies.set(GITHUB_OAUTH_STATE_COOKIE, "", options);
  response.cookies.set(GITHUB_OAUTH_VERIFIER_COOKIE, "", options);
  response.cookies.set(GITHUB_OAUTH_RETURN_TO_COOKIE, "", options);
  return response;
}

function safeEquals(value: string, expected: string) {
  const valueBytes = Buffer.from(value);
  const expectedBytes = Buffer.from(expected);
  return valueBytes.length === expectedBytes.length && timingSafeEqual(valueBytes, expectedBytes);
}
