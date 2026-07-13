import { NextResponse } from "next/server";
import type { PostgresAuthStore } from "../../../../server/postgresAuthStore";
import { parseAuthJson } from "../authRequest";
import { enforceAuthRateLimit, type RouteAuthSecurity } from "../authSecurity";
import {
  getSessionCookieOptions,
  getSessionToken,
  SESSION_COOKIE_NAME,
} from "../../../../server/sessionCookie";

export function createSessionRouteHandlers(authStore: PostgresAuthStore, security: RouteAuthSecurity) {
  return {
    async GET(request: Request) {
      const user = await authStore.getUserBySessionToken(getSessionToken(request));

      if (!user) {
        return NextResponse.json({ error: "请先进入工作区" }, { status: 401 });
      }

      return NextResponse.json({ mode: "database", user });
    },

    async POST(request: Request) {
      const payload = await parseAuthJson(request);
      if (payload instanceof NextResponse) {
        return payload;
      }

      try {
        const email = typeof payload.email === "string" ? payload.email : "";
        const limitedResponse = await enforceAuthRateLimit(security, request, "login", email);
        if (limitedResponse) {
          return limitedResponse;
        }
        const session = await authStore.loginWithPassword({
          email,
          password: typeof payload.password === "string" ? payload.password : "",
        });
        await security.reset(request, "login", email);
        await security.audit(request, "password-login", true, session.user.id);
        const response = NextResponse.json({ mode: "database", user: session.user });
        response.cookies.set(SESSION_COOKIE_NAME, session.token, getSessionCookieOptions(session.expiresAt));
        return response;
      } catch (error) {
        if (error instanceof Error && error.message === "邮箱或密码错误") {
          await security.audit(request, "password-login", false, null);
          return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
        }
        throw error;
      }
    },

    async DELETE(request: Request) {
      await authStore.deleteSession(getSessionToken(request));
      const response = new NextResponse(null, { status: 204 });
      response.cookies.set(SESSION_COOKIE_NAME, "", {
        ...getSessionCookieOptions(0),
        maxAge: 0,
      });
      return response;
    },
  };
}
