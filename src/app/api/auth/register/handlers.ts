import { NextResponse } from "next/server";
import {
  AUTH_CODE_COOLDOWN_SECONDS,
  AuthCodeCooldownError,
  type AppUser,
  type PostgresAuthStore,
} from "../../../../server/postgresAuthStore";
import { parseAuthJson } from "../authRequest";
import { authErrorResponse } from "../authErrorResponse";
import { enforceAuthRateLimit, recordAuthAudit, type RouteAuthSecurity } from "../authSecurity";

interface RegistrationMailer {
  sendEmailVerificationCode(user: AppUser, code: string): Promise<void>;
}

export function createRegisterRouteHandler({
  authStore,
  mailer,
  security,
}: {
  authStore: PostgresAuthStore;
  mailer: RegistrationMailer;
  security: RouteAuthSecurity;
}) {
  return async (request: Request) => {
    const payload = await parseAuthJson(request);
    if (payload instanceof NextResponse) {
      return payload;
    }

    const email = typeof payload.email === "string" ? payload.email : "";
    const limitedResponse = await enforceAuthRateLimit(security, request, "register", email);
    if (limitedResponse) {
      return limitedResponse;
    }

    let registration: Awaited<ReturnType<PostgresAuthStore["register"]>>;
    try {
      registration = await authStore.register({
        displayName: typeof payload.displayName === "string" ? payload.displayName : "",
        email,
        password: typeof payload.password === "string" ? payload.password : "",
      });
    } catch (error) {
      await recordAuthAudit(security, request, "registration", false, null);
      if (error instanceof AuthCodeCooldownError) {
        return NextResponse.json(
          {
            codeAvailable: true,
            error: error.message,
            retryAfterSeconds: error.retryAfterSeconds,
          },
          {
            headers: { "Retry-After": String(error.retryAfterSeconds) },
            status: 429,
          },
        );
      }
      return authErrorResponse(error)
        ?? NextResponse.json({ error: "注册服务暂时不可用，请稍后重试" }, { status: 503 });
    }

    try {
      await mailer.sendEmailVerificationCode(registration.user, registration.code);
    } catch {
      await recordAuthAudit(security, request, "registration", false, registration.user.id);
      return NextResponse.json(
        { error: "验证邮件发送失败，请检查邮箱地址或稍后重试" },
        { status: 503 },
      );
    }

    await recordAuthAudit(security, request, "registration", true, registration.user.id);
    return NextResponse.json({
      registered: true,
      retryAfterSeconds: AUTH_CODE_COOLDOWN_SECONDS,
    }, { status: 201 });
  };
}
