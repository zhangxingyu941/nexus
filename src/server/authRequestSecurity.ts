import {
  AuthRateLimitUnavailableError,
  createAuthRateLimiter,
  hashAuthIdentifier,
  type AuthRateLimiter,
} from "./authRateLimiter";

export type AuthRateLimitAction = "forgot-password" | "github-callback" | "login" | "register" | "reset-password" | "verify-email";

interface AuthAuditStore {
  recordAuditEvent(input: {
    eventType: string;
    ipHash: string;
    succeeded: boolean;
    userId: string | null;
  }): Promise<void>;
}

interface AuthRequestSecurityOptions {
  auditStore: AuthAuditStore;
  hashSecret: string;
  limiter: AuthRateLimiter;
}

const RATE_LIMIT_RULES: Record<AuthRateLimitAction, { limit: number; windowMs: number }> = {
  "forgot-password": { limit: 5, windowMs: 60 * 60 * 1000 },
  "github-callback": { limit: 20, windowMs: 10 * 60 * 1000 },
  login: { limit: 5, windowMs: 15 * 60 * 1000 },
  register: { limit: 5, windowMs: 60 * 60 * 1000 },
  "reset-password": { limit: 10, windowMs: 60 * 60 * 1000 },
  "verify-email": { limit: 8, windowMs: 15 * 60 * 1000 },
};

export class AuthRequestSecurity {
  constructor(private readonly options: AuthRequestSecurityOptions) {}

  async check(request: Request, action: AuthRateLimitAction, identifier: string) {
    const rule = RATE_LIMIT_RULES[action];
    try {
      const [identityResult, ipResult] = await Promise.all([
        this.options.limiter.consume({
          action: `${action}:identity`,
          identifier: identifier || "unknown",
          ...rule,
        }),
        this.options.limiter.consume({
          action: `${action}:ip`,
          identifier: getClientIp(request),
          ...rule,
        }),
      ]);
      const results = [identityResult, ipResult];
      const blockedResults = results.filter((result) => !result.allowed);
      const retryAfterMs = Math.max(...(blockedResults.length ? blockedResults : results).map((result) => result.retryAfterMs));
      return {
        allowed: identityResult.allowed && ipResult.allowed,
        retryAfterSeconds: Math.max(Math.ceil(retryAfterMs / 1000), 1),
        unavailable: false,
      };
    } catch (error) {
      if (error instanceof AuthRateLimitUnavailableError || error instanceof Error) {
        return { allowed: false, retryAfterSeconds: 1, unavailable: true };
      }
      throw error;
    }
  }

  async reset(request: Request, action: AuthRateLimitAction, identifier: string) {
    await Promise.all([
      this.options.limiter.reset({
        action: `${action}:identity`,
        identifier: identifier || "unknown",
      }),
      this.options.limiter.reset({
        action: `${action}:ip`,
        identifier: getClientIp(request),
      }),
    ]);
  }

  async audit(
    request: Request,
    eventType: string,
    succeeded: boolean,
    userId: string | null,
  ) {
    await this.options.auditStore.recordAuditEvent({
      eventType,
      ipHash: hashAuthIdentifier(getClientIp(request), this.options.hashSecret),
      succeeded,
      userId,
    });
  }
}

let sharedSecurity: {
  hashSecret: string;
  production: boolean;
  redisUrl: string | undefined;
  security: AuthRequestSecurity;
} | null = null;

export function getAuthRequestSecurity(auditStore: AuthAuditStore) {
  const production = process.env.NODE_ENV === "production";
  const redisUrl = process.env.REDIS_URL?.trim();
  const configuredSecret = process.env.AUTH_HASH_SECRET?.trim();
  if (production && !configuredSecret) {
    throw new Error("生产环境必须配置 AUTH_HASH_SECRET");
  }
  const hashSecret = configuredSecret || "development-only-auth-hash-secret";

  if (
    sharedSecurity?.hashSecret === hashSecret &&
    sharedSecurity.production === production &&
    sharedSecurity.redisUrl === redisUrl
  ) {
    return sharedSecurity.security;
  }

  const security = new AuthRequestSecurity({
    auditStore,
    hashSecret,
    limiter: createAuthRateLimiter({ hashSecret, production, redisUrl }),
  });
  sharedSecurity = { hashSecret, production, redisUrl, security };
  return security;
}

function getClientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0].trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return (forwarded || realIp || "unknown").slice(0, 64);
}
