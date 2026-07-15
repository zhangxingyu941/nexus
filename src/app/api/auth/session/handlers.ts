import { NextResponse } from "next/server";
import type { AuthCredentialService } from "../../../../server/authCredentialService";
import type { PostgresAuthStore } from "../../../../server/postgresAuthStore";
import { parseAuthJson } from "../authRequest";
import { authCredentialErrorResponse } from "../authCredentialResponse";
import { authErrorResponse } from "../authErrorResponse";
import { enforceAuthRateLimit, recordAuthAudit, type RouteAuthSecurity } from "../authSecurity";
import {
  getSessionCookieOptions,
  getSessionToken,
  SESSION_COOKIE_NAME,
} from "../../../../server/sessionCookie";

type AuthCredentialDecryptor = Pick<AuthCredentialService, "decrypt">;

export function createGetSessionRouteHandler(authStore: PostgresAuthStore) {
  return async (request: Request) => {
    const user = await authStore.getUserBySessionToken(getSessionToken(request));

    if (!user) {
      return NextResponse.json({ error: "请先进入工作区" }, { status: 401 });
    }

    return NextResponse.json({ mode: "database", user });
  };
}

export function createDeleteSessionRouteHandler(authStore: PostgresAuthStore) {
  return async (request: Request) => {
    await authStore.deleteSession(getSessionToken(request));
    const response = new NextResponse(null, { status: 204 });
    response.cookies.set(SESSION_COOKIE_NAME, "", {
      ...getSessionCookieOptions(0),
      maxAge: 0,
    });
    return response;
  };
}

export function createSessionRouteHandlers(
  authStore: PostgresAuthStore,
  security: RouteAuthSecurity,
  credentials: AuthCredentialDecryptor,
) {
  return {
    GET: createGetSessionRouteHandler(authStore),

    async POST(request: Request) {
      const payload = await parseAuthJson(request);
      if (payload instanceof NextResponse) {
        return payload;
      }

      const email = typeof payload.email === "string" ? payload.email : "";
      const limitedResponse = await enforceAuthRateLimit(security, request, "login", email);
      if (limitedResponse) {
        return limitedResponse;
      }

      try {
        const { password } = await credentials.decrypt({
          credential: payload.credential,
          email,
          payload,
          purpose: "login",
        });
        const session = await authStore.loginWithPassword({
          email,
          password: password ?? "",
        });
        await security.reset(request, "login", email);
        await recordAuthAudit(security, request, "password-login", true, session.user.id);
        const response = NextResponse.json({ mode: "database", user: session.user });
        response.cookies.set(SESSION_COOKIE_NAME, session.token, getSessionCookieOptions(session.expiresAt));
        return response;
      } catch (error) {
        await recordAuthAudit(security, request, "password-login", false, null);
        return authCredentialErrorResponse(error)
          ?? authErrorResponse(error)
          ?? NextResponse.json({ error: "登录服务暂时不可用，请稍后重试" }, { status: 503 });
      }
    },

    DELETE: createDeleteSessionRouteHandler(authStore),
  };
}
