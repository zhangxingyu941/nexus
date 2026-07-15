import {
  AuthRateLimitUnavailableError,
  createAuthRateLimiter,
  hashAuthIdentifier,
  type AuthRateLimiter,
} from "./authRateLimiter";

export type AuthRateLimitAction = "credential-challenge" | "forgot-password" | "github-callback" | "login" | "register" | "reset-password" | "verify-email";

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
  trustedProxy?: boolean;
}

const RATE_LIMIT_RULES: Record<AuthRateLimitAction, { limit: number; windowMs: number }> = {
  "credential-challenge": { limit: 30, windowMs: 60 * 1000 },
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
      const requests = [
        ...(identifier ? [{
          action: `${action}:identity`,
          identifier,
          ...rule,
        }] : []),
        {
          action: `${action}:ip`,
          identifier: getClientIp(request, this.options.trustedProxy === true),
          ...rule,
        },
      ];
      const results = await Promise.all(
        requests.map((input) => this.options.limiter.consume(input)),
      );
      const blockedResults = results.filter((result) => !result.allowed);
      const retryAfterMs = Math.max(...(blockedResults.length ? blockedResults : results).map((result) => result.retryAfterMs));
      return {
        allowed: results.every((result) => result.allowed),
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
    const requests = [
      ...(identifier ? [{
        action: `${action}:identity`,
        identifier,
      }] : []),
      {
        action: `${action}:ip`,
        identifier: getClientIp(request, this.options.trustedProxy === true),
      },
    ];
    await Promise.all(
      requests.map((input) => this.options.limiter.reset(input)),
    );
  }

  async audit(
    request: Request,
    eventType: string,
    succeeded: boolean,
    userId: string | null,
  ) {
    await this.options.auditStore.recordAuditEvent({
      eventType,
      ipHash: hashAuthIdentifier(
        getClientIp(request, this.options.trustedProxy === true),
        this.options.hashSecret,
      ),
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
  trustedProxy: boolean;
} | null = null;

export function getAuthRequestSecurity(auditStore: AuthAuditStore) {
  const production = process.env.NODE_ENV === "production";
  const redisUrl = process.env.REDIS_URL?.trim();
  const trustedProxy = process.env.AUTH_TRUST_PROXY === "true";
  const configuredSecret = process.env.AUTH_HASH_SECRET?.trim();
  if (production && !configuredSecret) {
    throw new Error("生产环境必须配置 AUTH_HASH_SECRET");
  }
  const hashSecret = configuredSecret || "development-only-auth-hash-secret";

  if (
    sharedSecurity?.hashSecret === hashSecret &&
    sharedSecurity.production === production &&
    sharedSecurity.redisUrl === redisUrl &&
    sharedSecurity.trustedProxy === trustedProxy
  ) {
    return sharedSecurity.security;
  }

  const security = new AuthRequestSecurity({
    auditStore,
    hashSecret,
    limiter: createAuthRateLimiter({ hashSecret, production, redisUrl }),
    trustedProxy,
  });
  sharedSecurity = { hashSecret, production, redisUrl, security, trustedProxy };
  return security;
}

function getClientIp(request: Request, trustedProxy: boolean) {
  if (!trustedProxy) {
    return "unknown";
  }
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0].trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return (forwarded || realIp || "unknown").slice(0, 64);
}
