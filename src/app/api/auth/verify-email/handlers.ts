import { NextResponse } from "next/server";
import type { CreatedSession } from "../../../../server/postgresAuthStore";
import { getSessionCookieOptions, SESSION_COOKIE_NAME } from "../../../../server/sessionCookie";
import { parseAuthJson } from "../authRequest";
import { enforceAuthRateLimit, type RouteAuthSecurity } from "../authSecurity";

interface VerifyEmailStore {
  verifyEmail(input: { code: string; email: string }): Promise<CreatedSession>;
}

export function createVerifyEmailRouteHandler(authStore: VerifyEmailStore, security: RouteAuthSecurity) {
  return async (request: Request) => {
    const payload = await parseAuthJson(request);
    if (payload instanceof NextResponse) {
      return payload;
    }

    const email = typeof payload.email === "string" ? payload.email : "";
    const code = typeof payload.code === "string" ? payload.code : "";
    const limitedResponse = await enforceAuthRateLimit(security, request, "verify-email", email);
    if (limitedResponse) {
      return limitedResponse;
    }

    try {
      const session = await authStore.verifyEmail({ code, email });
      await security.reset(request, "verify-email", email);
      await security.audit(request, "email-verification", true, session.user.id);
      const response = NextResponse.json({ user: session.user, verified: true });
      response.cookies.set(SESSION_COOKIE_NAME, session.token, getSessionCookieOptions(session.expiresAt));
      return response;
    } catch {
      await security.audit(request, "email-verification", false, null);
      return NextResponse.json({ error: "验证码无效或已过期" }, { status: 400 });
    }
  };
}
