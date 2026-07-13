import { NextResponse } from "next/server";
import type { CreatedSession } from "../../../../../server/postgresAuthStore";
import { getSessionCookieOptions, SESSION_COOKIE_NAME } from "../../../../../server/sessionCookie";
import { parseAuthJson } from "../../authRequest";
import { enforceAuthRateLimit, type RouteAuthSecurity } from "../../authSecurity";

interface ResetPasswordStore {
  resetPassword(input: { code: string; email: string; password: string }): Promise<CreatedSession>;
}

export function createResetPasswordRouteHandler(authStore: ResetPasswordStore, security: RouteAuthSecurity) {
  return async (request: Request) => {
    const payload = await parseAuthJson(request);
    if (payload instanceof NextResponse) {
      return payload;
    }

    const email = typeof payload.email === "string" ? payload.email : "";
    const code = typeof payload.code === "string" ? payload.code : "";
    const limitedResponse = await enforceAuthRateLimit(security, request, "reset-password", email);
    if (limitedResponse) {
      return limitedResponse;
    }

    try {
      const session = await authStore.resetPassword({
        code,
        email,
        password: typeof payload.password === "string" ? payload.password : "",
      });
      await security.reset(request, "reset-password", email);
      await security.audit(request, "password-reset", true, session.user.id);
      const response = NextResponse.json({ reset: true, user: session.user });
      response.cookies.set(SESSION_COOKIE_NAME, session.token, getSessionCookieOptions(session.expiresAt));
      return response;
    } catch (error) {
      await security.audit(request, "password-reset", false, null);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "无法重置密码" },
        { status: 400 },
      );
    }
  };
}
