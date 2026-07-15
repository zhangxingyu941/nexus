// @vitest-environment node

import {
  CompactEncrypt,
  compactDecrypt,
  exportJWK,
  generateKeyPair,
  type KeyLike,
} from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AuthRequestError,
  requestAuth,
  requestEncryptedAuth,
  type EncryptedAuthRequestInput,
} from "./authClient";

const INVALID_RESPONSE_MESSAGE = "认证服务响应异常，请稍后重试";
const ENCRYPTION_ERROR_MESSAGE = "浏览器无法加密认证凭据，请刷新页面或升级浏览器后重试";

let privateKey: KeyLike;
let publicJwk: JsonWebKey & { kid: string };

beforeAll(async () => {
  const keyPair = await generateKeyPair("RSA-OAEP-256", { extractable: true });
  privateKey = keyPair.privateKey;
  publicJwk = {
    ...await exportJWK(keyPair.publicKey),
    alg: "RSA-OAEP-256",
    kid: "browser-auth-test-key",
    use: "enc",
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("requestAuth", () => {
  it("preserves auth error metadata returned by the API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      code: "stable_error",
      codeAvailable: true,
      error: "邮箱尚未验证，请先使用邮件中的验证码完成注册",
      retryAfterSeconds: 37,
    }, 429)));

    const request = requestAuth("/api/auth/test", { email: "user@example.com" });

    await expect(request).rejects.toBeInstanceOf(AuthRequestError);
    await expect(request).rejects.toMatchObject({
      code: "stable_error",
      codeAvailable: true,
      message: "邮箱尚未验证，请先使用邮件中的验证码完成注册",
      name: "AuthRequestError",
      retryAfterSeconds: 37,
    });
  });

  it("uses the existing explicit network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private network detail")));

    await expect(requestAuth("/api/auth/test", {})).rejects.toMatchObject({
      message: "无法连接认证服务，请检查网络后重试",
      name: "AuthRequestError",
    });
  });

  it.each([
    ["invalid JSON", new Response("not-json")],
    ["a non-object payload", jsonResponse(null)],
  ])("uses the existing invalid-response error for %s", async (_name, response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(requestAuth("/api/auth/test", {})).rejects.toMatchObject({
      message: INVALID_RESPONSE_MESSAGE,
      name: "AuthRequestError",
    });
  });
});

describe("requestEncryptedAuth", () => {
  const encryptedCases: Array<{
    expectedBody: Record<string, unknown>;
    expectedEndpoint: string;
    expectedSecrets: Record<string, string>;
    input: EncryptedAuthRequestInput;
  }> = [
    {
      expectedBody: {},
      expectedEndpoint: "/api/auth/session",
      expectedSecrets: { password: "Login-Secret-2026!" },
      input: {
        body: {},
        email: "  LOGIN@Example.COM ",
        purpose: "login",
        secrets: { password: "Login-Secret-2026!" },
      },
    },
    {
      expectedBody: { displayName: "Ada Lovelace" },
      expectedEndpoint: "/api/auth/register",
      expectedSecrets: { password: "Register-Secret-2026!" },
      input: {
        body: { displayName: "Ada Lovelace" },
        email: "  REGISTER@Example.COM ",
        purpose: "register",
        secrets: { password: "Register-Secret-2026!" },
      },
    },
    {
      expectedBody: {},
      expectedEndpoint: "/api/auth/verify-email",
      expectedSecrets: { code: "482910" },
      input: {
        body: {},
        email: "  VERIFY@Example.COM ",
        purpose: "verify-email",
        secrets: { code: "482910" },
      },
    },
    {
      expectedBody: {},
      expectedEndpoint: "/api/auth/password/reset",
      expectedSecrets: { code: "735104", password: "Reset-Secret-2026!" },
      input: {
        body: {},
        email: "  RESET@Example.COM ",
        purpose: "reset-password",
        secrets: { code: "735104", password: "Reset-Secret-2026!" },
      },
    },
  ];

  it.each(encryptedCases)("encrypts $input.purpose secrets with the exact JWE contract", async ({
    expectedBody,
    expectedEndpoint,
    expectedSecrets,
    input,
  }) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(challengeResponse(`challenge-${input.purpose}`)))
      .mockResolvedValueOnce(jsonResponse({ accepted: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestEncryptedAuth(input)).resolves.toEqual({ accepted: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/credential-challenge");
    expect(readRequestBody(fetchMock, 0)).toEqual({ purpose: input.purpose });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(expectedEndpoint);

    const finalBody = readRequestBody(fetchMock, 1);
    expect(finalBody).toEqual({
      ...expectedBody,
      credential: expect.any(String),
      email: input.email.trim().toLowerCase(),
    });
    expect(finalBody).not.toHaveProperty("password");
    expect(finalBody).not.toHaveProperty("code");
    const serializedBody = JSON.stringify(finalBody);
    for (const secret of Object.values(expectedSecrets)) {
      expect(serializedBody).not.toContain(secret);
    }

    const decrypted = await decryptCredential(String(finalBody.credential));
    expect(decrypted.protectedHeader).toEqual({
      alg: "RSA-OAEP-256",
      enc: "A256GCM",
      kid: publicJwk.kid,
      typ: "nexus-auth+jwe",
    });
    expect(decrypted.payload).toEqual({
      challenge: `challenge-${input.purpose}`,
      email: input.email.trim().toLowerCase(),
      purpose: input.purpose,
      version: 1,
      ...expectedSecrets,
    });
  });

  it("ignores a caller-supplied endpoint at runtime", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(challengeResponse()))
      .mockResolvedValueOnce(jsonResponse({ accepted: true }));
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      ...loginInput(),
      endpoint: "https://attacker.example/collect",
    } as unknown as EncryptedAuthRequestInput;

    await expect(requestEncryptedAuth(input)).resolves.toEqual({ accepted: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/auth/session");
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://attacker.example/collect",
      expect.anything(),
    );
  });

  it.each([
    "credential_key_unknown",
    "credential_challenge_expired",
  ])("fetches a fresh challenge and retries %s exactly once", async (code) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(challengeResponse("challenge-first")))
      .mockResolvedValueOnce(jsonResponse({ code, error: "retry" }, 409))
      .mockResolvedValueOnce(jsonResponse(challengeResponse("challenge-second")))
      .mockResolvedValueOnce(jsonResponse({ code, error: "still rejected" }, 409));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestEncryptedAuth(loginInput())).rejects.toMatchObject({
      code,
      message: "still rejected",
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(readRequestBody(fetchMock, 0)).toEqual({ purpose: "login" });
    expect(readRequestBody(fetchMock, 2)).toEqual({ purpose: "login" });
    const first = await decryptCredential(String(readRequestBody(fetchMock, 1).credential));
    const second = await decryptCredential(String(readRequestBody(fetchMock, 3).credential));
    expect(first.payload.challenge).toBe("challenge-first");
    expect(second.payload.challenge).toBe("challenge-second");
  });

  it.each([
    "credential_challenge_reused",
    "credential_invalid",
    "credential_service_unavailable",
  ])("does not retry %s", async (code) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(challengeResponse()))
      .mockResolvedValueOnce(jsonResponse({ code, error: "rejected" }, 409));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestEncryptedAuth(loginInput())).rejects.toMatchObject({ code });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["algorithm", () => ({ ...challengeResponse(), algorithm: "RSA-OAEP" })],
    ["empty challenge", () => ({ ...challengeResponse(), challenge: "" })],
    ["non-finite expiry", () => ({ ...challengeResponse(), expiresAt: null })],
  ])("rejects an invalid challenge %s as an invalid response", async (_name, createPayload) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(createPayload()));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestEncryptedAuth(loginInput())).rejects.toMatchObject({
      message: INVALID_RESPONSE_MESSAGE,
      name: "AuthRequestError",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["non-RSA key", () => ({ ...publicJwk, kty: "EC" })],
    ["missing key id", () => {
      const { kid: _kid, ...keyWithoutKid } = publicJwk;
      return keyWithoutKid;
    }],
    ["missing key algorithm", () => {
      const { alg: _alg, ...keyWithoutAlgorithm } = publicJwk;
      return keyWithoutAlgorithm;
    }],
    ["wrong key algorithm", () => ({ ...publicJwk, alg: "RSA-OAEP" })],
    ["missing key use", () => {
      const { use: _use, ...keyWithoutUse } = publicJwk;
      return keyWithoutUse;
    }],
    ["wrong key use", () => ({ ...publicJwk, use: "sig" })],
    ["key operations metadata", () => ({ ...publicJwk, key_ops: ["encrypt"] })],
    ["private RSA key", () => ({ ...publicJwk, d: "private-material" })],
    ["extra key metadata", () => ({ ...publicJwk, x5c: ["certificate"] })],
  ])("rejects a %s without submitting credentials", async (_name, createKey) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      ...challengeResponse(),
      key: createKey(),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestEncryptedAuth(loginInput())).rejects.toMatchObject({
      message: ENCRYPTION_ERROR_MESSAGE,
      name: "AuthRequestError",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not reject a challenge based on the client clock", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Number.MAX_SAFE_INTEGER);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ...challengeResponse(), expiresAt: 1 }))
      .mockResolvedValueOnce(jsonResponse({ accepted: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestEncryptedAuth(loginInput())).resolves.toEqual({ accepted: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not submit a plaintext fallback when JOSE encryption fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(challengeResponse()));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(CompactEncrypt.prototype, "encrypt")
      .mockRejectedValue(new Error("private crypto detail"));

    await expect(requestEncryptedAuth(loginInput())).rejects.toMatchObject({
      message: ENCRYPTION_ERROR_MESSAGE,
      name: "AuthRequestError",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["credential", "password", "code"])(
    "rejects public body field %s before requesting a challenge",
    async (field) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const input = {
        ...loginInput(),
        body: { [field]: "must-not-be-public" },
      } as unknown as EncryptedAuthRequestInput;

      await expect(requestEncryptedAuth(input)).rejects.toMatchObject({
        message: ENCRYPTION_ERROR_MESSAGE,
        name: "AuthRequestError",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["an arbitrary login field", { ...loginInput(), body: { role: "owner" } }],
    ["an arbitrary verify-email field", {
      body: { displayName: "Ada" },
      email: "user@example.com",
      purpose: "verify-email",
      secrets: { code: "482910" },
    }],
    ["an arbitrary reset-password field", {
      body: { role: "owner" },
      email: "user@example.com",
      purpose: "reset-password",
      secrets: { code: "735104", password: "Reset-Secret-2026!" },
    }],
    ["email in a login body", { ...loginInput(), body: { email: "other@example.com" } }],
    ["email in a register body", {
      body: { displayName: "Ada", email: "other@example.com" },
      email: "user@example.com",
      purpose: "register",
      secrets: { password: "Register-Secret-2026!" },
    }],
    ["a missing register displayName", {
      body: {},
      email: "user@example.com",
      purpose: "register",
      secrets: { password: "Register-Secret-2026!" },
    }],
    ["an extra register field", {
      body: { displayName: "Ada", role: "owner" },
      email: "user@example.com",
      purpose: "register",
      secrets: { password: "Register-Secret-2026!" },
    }],
    ["a non-string register displayName", {
      body: { displayName: 42 },
      email: "user@example.com",
      purpose: "register",
      secrets: { password: "Register-Secret-2026!" },
    }],
  ])("rejects %s before requesting a challenge", async (_name, input) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestEncryptedAuth(
      input as unknown as EncryptedAuthRequestInput,
    )).rejects.toMatchObject({
      message: ENCRYPTION_ERROR_MESSAGE,
      name: "AuthRequestError",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects arbitrary secret names before requesting a challenge", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      ...loginInput(),
      secrets: { password: "Login-Secret-2026!", token: "not-allowed" },
    } as unknown as EncryptedAuthRequestInput;

    await expect(requestEncryptedAuth(input)).rejects.toMatchObject({
      message: ENCRYPTION_ERROR_MESSAGE,
      name: "AuthRequestError",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["network failure", () => Promise.reject(new Error("private network detail")), "无法连接认证服务，请检查网络后重试"],
    ["invalid JSON", () => Promise.resolve(new Response("not-json")), INVALID_RESPONSE_MESSAGE],
  ])("preserves the challenge %s message", async (_name, fetchResult, message) => {
    const fetchMock = vi.fn().mockImplementation(fetchResult);
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestEncryptedAuth(loginInput())).rejects.toMatchObject({
      message,
      name: "AuthRequestError",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function challengeResponse(challenge = "challenge-current") {
  return {
    algorithm: "RSA-OAEP-256",
    challenge,
    expiresAt: 2_000_000_000_000,
    key: publicJwk,
  };
}

function loginInput(): EncryptedAuthRequestInput {
  return {
    body: {},
    email: "  USER@Example.COM ",
    purpose: "login",
    secrets: { password: "Login-Secret-2026!" },
  };
}

function readRequestBody(fetchMock: ReturnType<typeof vi.fn>, callIndex: number) {
  const request = fetchMock.mock.calls[callIndex];
  const init = request?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

async function decryptCredential(credential: string) {
  const decrypted = await compactDecrypt(credential, privateKey, {
    contentEncryptionAlgorithms: ["A256GCM"],
    keyManagementAlgorithms: ["RSA-OAEP-256"],
  });
  return {
    payload: JSON.parse(new TextDecoder().decode(decrypted.plaintext)) as Record<string, unknown>,
    protectedHeader: decrypted.protectedHeader,
  };
}
