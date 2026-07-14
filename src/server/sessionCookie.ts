export const SESSION_COOKIE_NAME = "notion_editor_session";

export function getCookieValue(request: Request, cookieName: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";

  for (const cookie of cookieHeader.split(";")) {
    const separatorIndex = cookie.indexOf("=");

    if (separatorIndex < 0) {
      continue;
    }

    const name = cookie.slice(0, separatorIndex).trim();
    if (name === cookieName) {
      return decodeURIComponent(cookie.slice(separatorIndex + 1).trim());
    }
  }

  return "";
}

export function getSessionToken(request: Request) {
  return getCookieValue(request, SESSION_COOKIE_NAME);
}

export function getSessionCookieOptions(expiresAt: number) {
  const configuredSecure = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  const secure = configuredSecure === "true"
    ? true
    : configuredSecure === "false"
      ? false
      : process.env.NODE_ENV === "production";

  return {
    expires: new Date(expiresAt),
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure,
  };
}
