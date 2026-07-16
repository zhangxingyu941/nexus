import { createHmac, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

const INVITE_CONTEXT_AUDIENCE = "nexus-workspace-invite";
const INVITE_CONTEXT_ISSUER = "nexus";
const INVITE_CONTEXT_MAX_LIFETIME_MS = 30 * 60_000;
const encoder = new TextEncoder();

export interface WorkspaceInviteContext {
  expiresAt: number;
  inviteId: string;
  tokenHash: string;
}

export class WorkspaceInviteTokenService {
  private readonly key: Uint8Array;

  constructor(
    private readonly secret: string,
    private readonly now: () => number = Date.now,
  ) {
    this.key = encoder.encode(secret);
    if (!secret.trim() || this.key.byteLength < 32) {
      throw new TypeError("Workspace invite secret must be at least 32 UTF-8 bytes");
    }
  }

  createRawToken() {
    return randomBytes(32).toString("base64url");
  }

  hashRawToken(token: string) {
    return createHmac("sha256", this.secret)
      .update("workspace-invite\0")
      .update(token)
      .digest("hex");
  }

  async signContext(input: WorkspaceInviteContext) {
    const expiresAt = Math.min(input.expiresAt, this.now() + INVITE_CONTEXT_MAX_LIFETIME_MS);
    return new SignJWT({
      expiresAt,
      inviteId: input.inviteId,
      tokenHash: input.tokenHash,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setAudience(INVITE_CONTEXT_AUDIENCE)
      .setIssuer(INVITE_CONTEXT_ISSUER)
      .setExpirationTime(Math.ceil(expiresAt / 1_000))
      .sign(this.key);
  }

  async verifyContext(context: string): Promise<WorkspaceInviteContext> {
    const now = this.now();
    const verified = await jwtVerify(context, this.key, {
      algorithms: ["HS256"],
      audience: INVITE_CONTEXT_AUDIENCE,
      currentDate: new Date(now),
      issuer: INVITE_CONTEXT_ISSUER,
      typ: "JWT",
    });
    const { exp, expiresAt, inviteId, tokenHash } = verified.payload;

    if (
      typeof exp !== "number"
      || !Number.isFinite(exp)
      || typeof expiresAt !== "number"
      || !Number.isFinite(expiresAt)
      || typeof inviteId !== "string"
      || typeof tokenHash !== "string"
    ) {
      throw new TypeError("Invalid workspace invite context");
    }

    if (now >= expiresAt) {
      throw new TypeError("Workspace invite context expired");
    }

    return {
      expiresAt,
      inviteId,
      tokenHash,
    };
  }
}
