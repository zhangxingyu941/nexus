import { NextResponse } from "next/server";
import type { AuthCredentialService } from "../../../../server/authCredentialService";
import type { CreatedSession } from "../../../../server/postgresAuthStore";
import { getSessionCookieOptions, SESSION_COOKIE_NAME } from "../../../../server/sessionCookie";
import { parseAuthJson } from "../authRequest";
import { authCredentialErrorResponse } from "../authCredentialResponse";
import { authErrorResponse } from "../authErrorResponse";
import { enforceAuthRateLimit, recordAuthAudit, type RouteAuthSecurity } from "../authSecurity";

interface VerifyEmailStore {
  verifyEmail(input: { code: string; email: string }): Promise<CreatedSession>;
}

type AuthCredentialDecryptor = Pick<AuthCredentialService, "decrypt">;

export function createVerifyEmailRouteHandler(
  authStore: VerifyEmailStore,
  security: RouteAuthSecurity,
  credentials: AuthCredentialDecryptor,
) {
  return async (request: Request) => {
    const payload = await parseAuthJson(request);
    if (payload instanceof NextResponse) {
      return payload;
    }

    const email = typeof payload.email === "string" ? payload.email : "";
    const limitedResponse = await enforceAuthRateLimit(security, request, "verify-email", email);
    if (limitedResponse) {
      return limitedResponse;
    }

    try {
      const { code } = await credentials.decrypt({
        credential: payload.credential,
        email,
        payload,
        purpose: "verify-email",
      });
      const session = await authStore.verifyEmail({ code: code ?? "", email });
      await security.reset(request, "verify-email", email);
      await recordAuthAudit(security, request, "email-verification", true, session.user.id);
      const response = NextResponse.json({ user: session.user, verified: true });
      response.cookies.set(SESSION_COOKIE_NAME, session.token, getSessionCookieOptions(session.expiresAt));
      return response;
    } catch (error) {
      await recordAuthAudit(security, request, "email-verification", false, null);
      return authCredentialErrorResponse(error)
        ?? authErrorResponse(error)
        ?? NextResponse.json({ error: "邮箱验证服务暂时不可用，请稍后重试" }, { status: 503 });
    }
  };
}
