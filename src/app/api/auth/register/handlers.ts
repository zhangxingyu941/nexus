import { NextResponse } from "next/server";
import {
  AUTH_CODE_COOLDOWN_SECONDS,
  AuthCodeCooldownError,
  type AppUser,
  type PostgresAuthStore,
} from "../../../../server/postgresAuthStore";
import { parseAuthJson } from "../authRequest";
import { enforceAuthRateLimit, type RouteAuthSecurity } from "../authSecurity";

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

    try {
      const registration = await authStore.register({
        displayName: typeof payload.displayName === "string" ? payload.displayName : "",
        email,
        password: typeof payload.password === "string" ? payload.password : "",
      });
      await mailer.sendEmailVerificationCode(registration.user, registration.code);
      await security.audit(request, "registration", true, registration.user.id);
      return NextResponse.json({
        registered: true,
        retryAfterSeconds: AUTH_CODE_COOLDOWN_SECONDS,
      }, { status: 201 });
    } catch (error) {
      await security.audit(request, "registration", false, null);
      if (error instanceof AuthCodeCooldownError) {
        return NextResponse.json(
          { error: error.message, retryAfterSeconds: error.retryAfterSeconds },
          {
            headers: { "Retry-After": String(error.retryAfterSeconds) },
            status: 429,
          },
        );
      }
      if (error instanceof Error && error.message === "SMTP 未配置") {
        return NextResponse.json({ error: "验证邮件暂时无法发送" }, { status: 503 });
      }
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "无法创建账号" },
        { status: 400 },
      );
    }
  };
}
