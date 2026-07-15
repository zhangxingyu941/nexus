import { CompactEncrypt, importJWK, type JWK } from "jose";
import type { EditorSessionUser } from "../features/editor/session/sessionTypes";

const CREDENTIAL_CHALLENGE_ENDPOINT = "/api/auth/credential-challenge";
const ENCRYPTION_ERROR_MESSAGE = "浏览器无法加密认证凭据，请刷新页面或升级浏览器后重试";
const INVALID_RESPONSE_MESSAGE = "认证服务响应异常，请稍后重试";
const AUTH_ENDPOINTS = {
  login: "/api/auth/session",
  register: "/api/auth/register",
  "reset-password": "/api/auth/password/reset",
  "verify-email": "/api/auth/verify-email",
} as const;
const RETRYABLE_CREDENTIAL_CODES = new Set([
  "credential_key_unknown",
  "credential_challenge_expired",
]);
const PUBLIC_RSA_JWK_KEYS = ["alg", "e", "kid", "kty", "n", "use"] as const;

type EmptyAuthPublicBody = Record<string, never>;

interface EncryptedAuthRequestBase {
  email: string;
}

export type EncryptedAuthRequestInput = EncryptedAuthRequestBase & (
  | {
    body: EmptyAuthPublicBody;
    purpose: "login";
    secrets: { code?: never; password: string };
  }
  | {
    body: { displayName: string };
    purpose: "register";
    secrets: { code?: never; password: string };
  }
  | {
    body: EmptyAuthPublicBody;
    purpose: "verify-email";
    secrets: { code: string; password?: never };
  }
  | {
    body: EmptyAuthPublicBody;
    purpose: "reset-password";
    secrets: { code: string; password: string };
  }
);

interface AuthResponse {
  code?: string;
  codeAvailable?: boolean;
  error?: string;
  retryAfterSeconds?: number;
  user?: EditorSessionUser;
}

export class AuthRequestError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds?: number,
    readonly codeAvailable = false,
    readonly code?: string,
  ) {
    super(message);
    this.name = "AuthRequestError";
  }
}

export async function requestAuth(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<AuthResponse> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  } catch {
    throw new AuthRequestError("无法连接认证服务，请检查网络后重试");
  }

  let parsedPayload: unknown;
  try {
    parsedPayload = await response.json();
  } catch {
    throw new AuthRequestError("认证服务响应异常，请稍后重试");
  }
  if (!isRecord(parsedPayload)) {
    throw new AuthRequestError("认证服务响应异常，请稍后重试");
  }

  const payload = parsedPayload as AuthResponse;
  if (!response.ok) {
    throw new AuthRequestError(
      typeof payload.error === "string" && payload.error
        ? payload.error
        : "认证请求失败",
      typeof payload.retryAfterSeconds === "number"
        ? payload.retryAfterSeconds
        : undefined,
      payload.codeAvailable === true,
      typeof payload.code === "string" ? payload.code : undefined,
    );
  }
  return payload;
}

export async function requestEncryptedAuth(
  input: EncryptedAuthRequestInput,
): Promise<AuthResponse> {
  validateEncryptedAuthInput(input);
  const email = input.email.trim().toLowerCase();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const challengePayload = await requestAuth(CREDENTIAL_CHALLENGE_ENDPOINT, {
      purpose: input.purpose,
    });
    const challenge = parseChallenge(challengePayload);
    const credential = await encryptCredential(input, email, challenge);

    try {
      return await requestAuth(AUTH_ENDPOINTS[input.purpose], {
        ...input.body,
        email,
        credential,
      });
    } catch (error) {
      if (
        attempt === 0
        && error instanceof AuthRequestError
        && error.code !== undefined
        && RETRYABLE_CREDENTIAL_CODES.has(error.code)
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new AuthRequestError("认证请求失败");
}

interface ParsedChallenge {
  challenge: string;
  key: JWK & { kid: string };
}

function parseChallenge(payload: unknown): ParsedChallenge {
  if (
    !isRecord(payload)
    || payload.algorithm !== "RSA-OAEP-256"
    || typeof payload.challenge !== "string"
    || payload.challenge.trim().length === 0
    || typeof payload.expiresAt !== "number"
    || !Number.isFinite(payload.expiresAt)
    || !isRecord(payload.key)
  ) {
    throw new AuthRequestError(INVALID_RESPONSE_MESSAGE);
  }

  return {
    challenge: payload.challenge,
    key: validatePublicRsaJwk(payload.key),
  };
}

function validatePublicRsaJwk(key: Record<string, unknown>): JWK & { kid: string } {
  if (
    !sameKeys(Object.keys(key).sort(), PUBLIC_RSA_JWK_KEYS)
    || key.kty !== "RSA"
    || typeof key.n !== "string"
    || key.n.length === 0
    || typeof key.e !== "string"
    || key.e.length === 0
    || typeof key.kid !== "string"
    || key.kid.trim().length === 0
    || key.alg !== "RSA-OAEP-256"
    || key.use !== "enc"
  ) {
    throw encryptionError();
  }

  return key as unknown as JWK & { kid: string };
}

async function encryptCredential(
  input: EncryptedAuthRequestInput,
  email: string,
  challenge: ParsedChallenge,
) {
  try {
    const publicKey = await importJWK(challenge.key, "RSA-OAEP-256");
    const plaintext = Uint8Array.from(new TextEncoder().encode(JSON.stringify({
      version: 1,
      purpose: input.purpose,
      email,
      challenge: challenge.challenge,
      ...input.secrets,
    })));
    return await new CompactEncrypt(plaintext)
      .setProtectedHeader({
        alg: "RSA-OAEP-256",
        enc: "A256GCM",
        kid: challenge.key.kid,
        typ: "nexus-auth+jwe",
      })
      .encrypt(publicKey);
  } catch {
    throw encryptionError();
  }
}

function validateEncryptedAuthInput(input: EncryptedAuthRequestInput) {
  if (
    !isRecord(input)
    || typeof input.email !== "string"
    || !isRecord(input.body)
    || !isRecord(input.secrets)
  ) {
    throw encryptionError();
  }

  const body: Record<string, unknown> = input.body;
  const expectedBodyKeys = input.purpose === "register" ? ["displayName"] : [];
  if (
    !sameKeys(Object.keys(body).sort(), expectedBodyKeys)
    || (input.purpose === "register" && typeof body.displayName !== "string")
  ) {
    throw encryptionError();
  }

  const secrets: Record<string, unknown> = input.secrets;
  const expectedSecretKeys = input.purpose === "verify-email"
    ? ["code"]
    : input.purpose === "reset-password"
      ? ["code", "password"]
      : input.purpose === "login" || input.purpose === "register"
        ? ["password"]
        : null;
  const actualSecretKeys = Object.keys(secrets).sort();
  if (
    expectedSecretKeys === null
    || !sameKeys(actualSecretKeys, expectedSecretKeys)
    || expectedSecretKeys.some((key) => typeof secrets[key] !== "string")
  ) {
    throw encryptionError();
  }
}

function encryptionError() {
  return new AuthRequestError(ENCRYPTION_ERROR_MESSAGE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameKeys(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}
