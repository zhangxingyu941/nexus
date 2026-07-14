import { NextResponse } from "next/server";
import {
  AUTH_CODE_COOLDOWN_SECONDS,
  AuthCodeCooldownError,
  type AppUser,
} from "../../../../../server/postgresAuthStore";
import { parseAuthJson } from "../../authRequest";
import { enforceAuthRateLimit, recordAuthAudit, type RouteAuthSecurity } from "../../authSecurity";

interface ForgotPasswordStore {
  createPasswordReset(email: string): Promise<{ code: string; user: AppUser } | null>;
}

interface PasswordResetMailer {
  sendPasswordResetCode(user: AppUser, code: string): Promise<void>;
}

export function createForgotPasswordRouteHandler({
  authStore,
  mailer,
  security,
}: {
  authStore: ForgotPasswordStore;
  mailer: PasswordResetMailer;
  security: RouteAuthSecurity;
}) {
  return async (request: Request) => {
    const payload = await parseAuthJson(request);
    if (payload instanceof NextResponse) {
      return payload;
    }

    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!email) {
      return NextResponse.json({ error: "请输入邮箱" }, { status: 400 });
    }
    if (email.length > 254) {
      return NextResponse.json({ error: "邮箱不能超过 254 个字符" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "请输入有效的邮箱地址" }, { status: 400 });
    }

    const limitedResponse = await enforceAuthRateLimit(security, request, "forgot-password", email);
    if (limitedResponse) {
      return limitedResponse;
    }

    let pendingReset: { code: string; user: AppUser } | null;
    try {
      pendingReset = await authStore.createPasswordReset(email);
    } catch (error) {
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
      return NextResponse.json(
        { error: "密码重置服务暂时不可用，请稍后重试" },
        { status: 503 },
      );
    }
    if (!pendingReset) {
      await recordAuthAudit(security, request, "password-reset-request", false, null);
      return NextResponse.json(
        { error: "该邮箱尚未注册，请先创建账号" },
        { status: 404 },
      );
    }

    try {
      await mailer.sendPasswordResetCode(pendingReset.user, pendingReset.code);
    } catch {
      await recordAuthAudit(security, request, "password-reset-request", false, pendingReset.user.id);
      return NextResponse.json(
        { error: "密码重置邮件发送失败，请检查邮箱地址或稍后重试" },
        { status: 503 },
      );
    }

    await recordAuthAudit(security, request, "password-reset-request", true, pendingReset.user.id);

    return NextResponse.json({
      accepted: true,
      retryAfterSeconds: AUTH_CODE_COOLDOWN_SECONDS,
    }, { status: 202 });
  };
}
