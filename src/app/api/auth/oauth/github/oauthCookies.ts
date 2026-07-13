export const GITHUB_OAUTH_STATE_COOKIE = "notion_editor_oauth_state";
export const GITHUB_OAUTH_VERIFIER_COOKIE = "notion_editor_oauth_verifier";

export function getOAuthCookieOptions(maxAge = 10 * 60) {
  return {
    httpOnly: true,
    maxAge,
    path: "/api/auth/oauth/github",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
