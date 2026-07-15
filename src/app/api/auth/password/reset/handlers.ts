import { NextResponse } from "next/server";
import type { AuthCredentialService } from "../../../../../server/authCredentialService";
import type { CreatedSession } from "../../../../../server/postgresAuthStore";
import { getSessionCookieOptions, SESSION_COOKIE_NAME } from "../../../../../server/sessionCookie";
import { parseAuthJson } from "../../authRequest";
import { authCredentialErrorResponse } from "../../authCredentialResponse";
import { authErrorResponse } from "../../authErrorResponse";
import { enforceAuthRateLimit, recordAuthAudit, type RouteAuthSecurity } from "../../authSecurity";

interface ResetPasswordStore {
  resetPassword(input: { code: string; email: string; password: string }): Promise<CreatedSession>;
}

type AuthCredentialDecryptor = Pick<AuthCredentialService, "decrypt">;

export function createResetPasswordRouteHandler(
  authStore: ResetPasswordStore,
  security: RouteAuthSecurity,
  credentials: AuthCredentialDecryptor,
) {
  return async (request: Request) => {
    const payload = await parseAuthJson(request);
    if (payload instanceof NextResponse) {
      return payload;
    }

    const email = typeof payload.email === "string" ? payload.email : "";
    const limitedResponse = await enforceAuthRateLimit(security, request, "reset-password", email);
    if (limitedResponse) {
      return limitedResponse;
    }

    try {
      const { code, password } = await credentials.decrypt({
        credential: payload.credential,
        email,
        payload,
        purpose: "reset-password",
      });
      const session = await authStore.resetPassword({
        code: code ?? "",
        email,
        password: password ?? "",
      });
      await security.reset(request, "reset-password", email);
      await recordAuthAudit(security, request, "password-reset", true, session.user.id);
      const response = NextResponse.json({ reset: true, user: session.user });
      response.cookies.set(SESSION_COOKIE_NAME, session.token, getSessionCookieOptions(session.expiresAt));
      return response;
    } catch (error) {
      await recordAuthAudit(security, request, "password-reset", false, null);
      return authCredentialErrorResponse(error)
        ?? authErrorResponse(error)
        ?? NextResponse.json({ error: "密码重置服务暂时不可用，请稍后重试" }, { status: 503 });
    }
  };
}
