import { NextResponse } from "next/server";
import type { AuthRateLimitAction } from "../../../server/authRequestSecurity";

export interface RouteAuthSecurity {
  audit(request: Request, eventType: string, succeeded: boolean, userId: string | null): Promise<void>;
  check(
    request: Request,
    action: AuthRateLimitAction,
    identifier: string,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number; unavailable: boolean }>;
  reset(request: Request, action: AuthRateLimitAction, identifier: string): Promise<void>;
}

export async function recordAuthAudit(
  security: RouteAuthSecurity,
  request: Request,
  eventType: string,
  succeeded: boolean,
  userId: string | null,
) {
  try {
    await security.audit(request, eventType, succeeded, userId);
  } catch {
    // Audit persistence is best-effort and must not replace the user-facing auth result.
  }
}

export async function enforceAuthRateLimit(
  security: RouteAuthSecurity,
  request: Request,
  action: AuthRateLimitAction,
  identifier: string,
) {
  const decision = await security.check(request, action, identifier);
  if (decision.allowed) {
    return null;
  }
  if (decision.unavailable) {
    return NextResponse.json({ error: "认证服务暂时不可用" }, { status: 503 });
  }

  return NextResponse.json(
    {
      error: `请求过于频繁，请在 ${decision.retryAfterSeconds} 秒后重试`,
      retryAfterSeconds: decision.retryAfterSeconds,
    },
    {
      headers: { "Retry-After": String(decision.retryAfterSeconds) },
      status: 429,
    },
  );
}
