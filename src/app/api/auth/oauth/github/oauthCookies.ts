export const GITHUB_OAUTH_STATE_COOKIE = "notion_editor_oauth_state";
export const GITHUB_OAUTH_VERIFIER_COOKIE = "notion_editor_oauth_verifier";
export const GITHUB_OAUTH_RETURN_TO_COOKIE = "notion_editor_oauth_return_to";

export function normalizeOAuthReturnTo(value: string | null | undefined) {
  if (
    !value
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return "/";
  }
  return value;
}

export function getOAuthCookieOptions(maxAge = 10 * 60) {
  return {
    httpOnly: true,
    maxAge,
    path: "/api/auth/oauth/github",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
