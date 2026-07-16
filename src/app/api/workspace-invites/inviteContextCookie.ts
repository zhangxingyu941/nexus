import type { NextResponse } from "next/server";

export const WORKSPACE_INVITE_CONTEXT_COOKIE = "nexus_workspace_invite_context";

const WORKSPACE_INVITE_CONTEXT_COOKIE_PATH = "/api/workspace-invites";

export function setWorkspaceInviteContextCookie(
  response: NextResponse,
  context: string,
  expiresAt: number,
) {
  response.cookies.set(
    WORKSPACE_INVITE_CONTEXT_COOKIE,
    context,
    getWorkspaceInviteContextCookieOptions(expiresAt),
  );
}

export function clearWorkspaceInviteContextCookie(response: NextResponse) {
  response.cookies.set(WORKSPACE_INVITE_CONTEXT_COOKIE, "", {
    ...getWorkspaceInviteContextCookieOptions(0),
    maxAge: 0,
  });
}

function getWorkspaceInviteContextCookieOptions(expiresAt: number) {
  return {
    expires: new Date(expiresAt),
    httpOnly: true,
    path: WORKSPACE_INVITE_CONTEXT_COOKIE_PATH,
    sameSite: "lax" as const,
    secure: isSecureCookie(),
  };
}

function isSecureCookie() {
  const configuredSecure = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  return configuredSecure === "true"
    ? true
    : configuredSecure === "false"
      ? false
      : process.env.NODE_ENV === "production";
}
