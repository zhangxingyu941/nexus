import { NextResponse } from "next/server";
import {
  AUTH_CODE_COOLDOWN_SECONDS,
  AuthCodeCooldownError,
  type AppUser,
} from "../../../../../server/postgresAuthStore";
import { parseAuthJson } from "../../authRequest";
import { enforceAuthRateLimit, type RouteAuthSecurity } from "../../authSecurity";

interface ForgotPasswordStore {
  createPasswordReset(email: string): Promise<{ code: string; user: AppUser } | null>;
}

interface PasswordResetMailer {
  sendPasswordResetCode(user: AppUser, code: string): Promise<void>;
}

export function createForgotPasswordRouteHandler({
  authStore,
  logger = console,
  mailer,
  security,
}: {
  authStore: ForgotPasswordStore;
  logger?: Pick<Console, "error">;
  mailer: PasswordResetMailer;
  security: RouteAuthSecurity;
}) {
  return async (request: Request) => {
    const payload = await parseAuthJson(request);
    if (payload instanceof NextResponse) {
      return payload;
    }

    const email = typeof payload.email === "string" ? payload.email : "";
    if (!email || email.length > 254) {
      return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
    }

    const limitedResponse = await enforceAuthRateLimit(security, request, "forgot-password", email);
    if (limitedResponse) {
      return limitedResponse;
    }

    let pendingReset: { code: string; user: AppUser } | null = null;
    try {
      pendingReset = await authStore.createPasswordReset(email);
    } catch (error) {
      if (!(error instanceof AuthCodeCooldownError)) {
        throw error;
      }
    }
    if (pendingReset) {
      try {
        await mailer.sendPasswordResetCode(pendingReset.user, pendingReset.code);
      } catch {
        logger.error("密码重置邮件发送失败");
      }
    }

    await security.audit(request, "password-reset-request", true, pendingReset?.user.id ?? null);

    return NextResponse.json({
      accepted: true,
      retryAfterSeconds: AUTH_CODE_COOLDOWN_SECONDS,
    }, { status: 202 });
  };
}
