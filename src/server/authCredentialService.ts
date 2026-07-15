import { randomBytes } from "node:crypto";
import {
  SignJWT,
  compactDecrypt,
  decodeProtectedHeader,
  errors,
  jwtVerify,
} from "jose";
import {
  AUTH_CREDENTIAL_PURPOSES,
  type AuthCredentialChallengeResponse,
  type AuthCredentialErrorCode,
  type AuthCredentialPurpose,
} from "../shared/authCredential";
import type { LoadedAuthCredentialKey } from "./authCredentialKey";
import type { AuthCredentialReplayStore } from "./authCredentialReplayStore";

const CHALLENGE_LIFETIME_MS = 60_000;
const CHALLENGE_TYPE = "nexus-auth-challenge+jwt";
const JWE_TYPE = "nexus-auth+jwe";
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

const AUTH_CREDENTIAL_ERROR_MESSAGES: Record<AuthCredentialErrorCode, string> = {
  credential_challenge_expired: "加密凭据已过期，请重新提交",
  credential_challenge_reused: "加密凭据已使用，请重新提交",
  credential_invalid: "加密凭据无效，请重新提交",
  credential_key_unknown: "加密凭据密钥已更新，请重新提交",
  credential_required: "请提供加密凭据",
  credential_service_unavailable: "安全凭据服务未正确配置，请联系管理员",
  plaintext_credential_forbidden: "认证请求不得包含明文密码或验证码",
};

const EXPECTED_PAYLOAD_KEYS: Record<AuthCredentialPurpose, readonly string[]> = {
  login: ["challenge", "email", "password", "purpose", "version"],
  register: ["challenge", "email", "password", "purpose", "version"],
  "reset-password": ["challenge", "code", "email", "password", "purpose", "version"],
  "verify-email": ["challenge", "code", "email", "purpose", "version"],
};

export class AuthCredentialError extends Error {
  constructor(readonly code: AuthCredentialErrorCode) {
    super(AUTH_CREDENTIAL_ERROR_MESSAGES[code]);
    this.name = "AuthCredentialError";
  }
}

export interface AuthCredentialDecryptInput {
  credential: unknown;
  email: string;
  payload: Record<string, unknown>;
  purpose: AuthCredentialPurpose;
}

export interface AuthCredentialDecryptResult {
  code?: string;
  password?: string;
}

export interface AuthCredentialServiceOptions {
  hashSecret: string;
  jtiFactory?: () => string;
  key: LoadedAuthCredentialKey;
  now?: () => number;
  replayStore: AuthCredentialReplayStore;
}

export class AuthCredentialService {
  private readonly challengeSigningKey: Uint8Array;
  private readonly jtiFactory: () => string;
  private readonly now: () => number;
  private readonly publicJwk: {
    alg: "RSA-OAEP-256";
    e: string;
    kid: string;
    kty: "RSA";
    n: string;
    use: "enc";
  };

  constructor(private readonly options: AuthCredentialServiceOptions) {
    const challengeSigningKey = encoder.encode(options.hashSecret);
    if (
      !options.hashSecret.trim()
      || challengeSigningKey.byteLength < 32
      || !options.key?.kid
      || !options.key.privateKey
      || !options.replayStore
    ) {
      throw new AuthCredentialError("credential_service_unavailable");
    }

    this.challengeSigningKey = challengeSigningKey;
    this.jtiFactory = options.jtiFactory ?? (() => randomBytes(32).toString("base64url"));
    this.now = options.now ?? Date.now;
    this.publicJwk = createPublicCredentialJwk(options.key);
  }

  async issueChallenge(
    purpose: AuthCredentialPurpose,
  ): Promise<AuthCredentialChallengeResponse> {
    if (!isAuthCredentialPurpose(purpose)) {
      throw new AuthCredentialError("credential_invalid");
    }

    const issuedAt = this.now();
    const expiresAt = issuedAt + CHALLENGE_LIFETIME_MS;

    try {
      const jti = this.jtiFactory();
      if (!isValidJti(jti)) {
        throw new AuthCredentialError("credential_service_unavailable");
      }

      const challenge = await new SignJWT({ purpose })
        .setProtectedHeader({ alg: "HS256", typ: CHALLENGE_TYPE })
        .setJti(jti)
        .setIssuedAt(issuedAt / 1_000)
        .setExpirationTime(expiresAt / 1_000)
        .sign(this.challengeSigningKey);

      return {
        algorithm: "RSA-OAEP-256",
        challenge,
        expiresAt,
        key: {
          alg: this.publicJwk.alg,
          e: this.publicJwk.e,
          kid: this.publicJwk.kid,
          kty: this.publicJwk.kty,
          n: this.publicJwk.n,
          use: this.publicJwk.use,
        },
      };
    } catch (error) {
      if (error instanceof AuthCredentialError) {
        throw error;
      }
      throw new AuthCredentialError("credential_service_unavailable");
    }
  }

  async decrypt(input: AuthCredentialDecryptInput): Promise<AuthCredentialDecryptResult> {
    if (isRecord(input.payload) && (
      hasOwn(input.payload, "password") || hasOwn(input.payload, "code")
    )) {
      throw new AuthCredentialError("plaintext_credential_forbidden");
    }

    if (input.credential === undefined || input.credential === null || input.credential === "") {
      throw new AuthCredentialError("credential_required");
    }
    if (
      typeof input.credential !== "string"
      || typeof input.email !== "string"
      || !isRecord(input.payload)
      || !isAuthCredentialPurpose(input.purpose)
    ) {
      throw new AuthCredentialError("credential_invalid");
    }

    validateJweHeader(input.credential, this.options.key.kid);
    const plaintext = await decryptCredential(
      input.credential,
      this.options.key.privateKey,
    );
    const payload = parseCredentialPayload(plaintext, input.purpose);
    if (
      payload.purpose !== input.purpose
      || normalizeEmail(payload.email) !== normalizeEmail(input.email)
    ) {
      throw new AuthCredentialError("credential_invalid");
    }

    const challenge = await this.verifyChallenge(payload.challenge, input.purpose);
    this.assertChallengeUnexpired(challenge.expiresAt);
    let consumed: boolean;
    try {
      consumed = await this.options.replayStore.consume(
        challenge.jti,
        challenge.expiresAt,
      );
    } catch {
      this.assertChallengeUnexpired(challenge.expiresAt);
      throw new AuthCredentialError("credential_service_unavailable");
    }
    this.assertChallengeUnexpired(challenge.expiresAt);
    if (consumed === false) {
      throw new AuthCredentialError("credential_challenge_reused");
    }
    if (consumed !== true) {
      throw new AuthCredentialError("credential_service_unavailable");
    }

    if (input.purpose === "verify-email") {
      return { code: payload.code };
    }
    if (input.purpose === "reset-password") {
      return { code: payload.code, password: payload.password };
    }
    return { password: payload.password };
  }

  private assertChallengeUnexpired(expiresAt: number) {
    if (this.now() >= expiresAt) {
      throw new AuthCredentialError("credential_challenge_expired");
    }
  }

  private async verifyChallenge(
    challenge: string,
    purpose: AuthCredentialPurpose,
  ): Promise<{ expiresAt: number; jti: string }> {
    const currentTime = this.now();
    try {
      const verified = await jwtVerify(challenge, this.challengeSigningKey, {
        algorithms: ["HS256"],
        currentDate: new Date(currentTime),
        typ: CHALLENGE_TYPE,
      });
      const { exp, iat, jti } = verified.payload;
      if (
        verified.protectedHeader.alg !== "HS256"
        || verified.protectedHeader.typ !== CHALLENGE_TYPE
        || verified.payload.purpose !== purpose
        || typeof jti !== "string"
        || !isValidJti(jti)
        || typeof iat !== "number"
        || !Number.isFinite(iat)
        || typeof exp !== "number"
        || !Number.isFinite(exp)
        || iat > currentTime / 1_000
        || exp <= iat
        || Math.abs((exp - iat) * 1_000 - CHALLENGE_LIFETIME_MS) > 0.001
      ) {
        throw new AuthCredentialError("credential_invalid");
      }
      if (currentTime >= exp * 1_000) {
        throw new AuthCredentialError("credential_challenge_expired");
      }
      return { expiresAt: exp * 1_000, jti };
    } catch (error) {
      if (error instanceof AuthCredentialError) {
        throw error;
      }
      if (error instanceof errors.JWTExpired) {
        throw new AuthCredentialError("credential_challenge_expired");
      }
      throw new AuthCredentialError("credential_invalid");
    }
  }
}

type ParsedCredentialPayload = {
  challenge: string;
  code?: string;
  email: string;
  password?: string;
  purpose: AuthCredentialPurpose;
  version: 1;
};

function createPublicCredentialJwk(key: LoadedAuthCredentialKey) {
  const { e, kty, n } = key.publicJwk ?? {};
  if (
    kty !== "RSA"
    || typeof n !== "string"
    || !n
    || typeof e !== "string"
    || !e
  ) {
    throw new AuthCredentialError("credential_service_unavailable");
  }

  return {
    alg: "RSA-OAEP-256" as const,
    e,
    kid: key.kid,
    kty: "RSA" as const,
    n,
    use: "enc" as const,
  };
}

async function decryptCredential(credential: string, privateKey: LoadedAuthCredentialKey["privateKey"]) {
  try {
    const result = await compactDecrypt(credential, privateKey, {
      contentEncryptionAlgorithms: ["A256GCM"],
      keyManagementAlgorithms: ["RSA-OAEP-256"],
    });
    return result.plaintext;
  } catch {
    throw new AuthCredentialError("credential_invalid");
  }
}

function validateJweHeader(credential: string, currentKid: string) {
  let protectedHeader;
  try {
    protectedHeader = decodeProtectedHeader(credential);
  } catch {
    throw new AuthCredentialError("credential_invalid");
  }

  if (typeof protectedHeader.kid === "string" && protectedHeader.kid !== currentKid) {
    throw new AuthCredentialError("credential_key_unknown");
  }

  const keys = Object.keys(protectedHeader).sort();
  if (
    !sameKeys(keys, ["alg", "enc", "kid", "typ"])
    || protectedHeader.alg !== "RSA-OAEP-256"
    || protectedHeader.enc !== "A256GCM"
    || protectedHeader.kid !== currentKid
    || protectedHeader.typ !== JWE_TYPE
  ) {
    throw new AuthCredentialError("credential_invalid");
  }
}

function parseCredentialPayload(
  plaintext: Uint8Array,
  purpose: AuthCredentialPurpose,
): ParsedCredentialPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(plaintext));
  } catch {
    throw new AuthCredentialError("credential_invalid");
  }
  if (!isRecord(parsed)) {
    throw new AuthCredentialError("credential_invalid");
  }

  const keys = Object.keys(parsed).sort();
  if (
    !sameKeys(keys, EXPECTED_PAYLOAD_KEYS[purpose])
    || parsed.version !== 1
    || typeof parsed.purpose !== "string"
    || typeof parsed.email !== "string"
    || typeof parsed.challenge !== "string"
    || !parsed.challenge
  ) {
    throw new AuthCredentialError("credential_invalid");
  }

  if (
    (purpose === "login" || purpose === "register")
    && typeof parsed.password !== "string"
  ) {
    throw new AuthCredentialError("credential_invalid");
  }
  if (purpose === "verify-email" && typeof parsed.code !== "string") {
    throw new AuthCredentialError("credential_invalid");
  }
  if (
    purpose === "reset-password"
    && (typeof parsed.code !== "string" || typeof parsed.password !== "string")
  ) {
    throw new AuthCredentialError("credential_invalid");
  }

  return parsed as ParsedCredentialPayload;
}

function isAuthCredentialPurpose(value: unknown): value is AuthCredentialPurpose {
  return typeof value === "string"
    && AUTH_CREDENTIAL_PURPOSES.some((purpose) => purpose === value);
}

function isValidJti(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function sameKeys(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}
