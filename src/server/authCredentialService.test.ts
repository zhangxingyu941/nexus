// @vitest-environment node

import { generateKeyPairSync } from "node:crypto";
import {
  CompactEncrypt,
  decodeProtectedHeader,
  exportJWK,
  jwtVerify,
  type KeyLike,
} from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AuthCredentialErrorCode,
  AuthCredentialPurpose,
} from "../shared/authCredential";
import type { LoadedAuthCredentialKey } from "./authCredentialKey";
import {
  AuthCredentialServiceUnavailableError,
  InMemoryAuthCredentialReplayStore,
  type AuthCredentialReplayStore,
} from "./authCredentialReplayStore";
import {
  AuthCredentialError,
  AuthCredentialService,
} from "./authCredentialService";

const HASH_SECRET = "test-auth-hash-secret-at-least-32-bytes";
const KEY_ID = "auth-test-key";
const START_TIME = 1_750_000_000_000;
const TEST_JTI = Buffer.alloc(32, 7).toString("base64url");
const encoder = new TextEncoder();

let encryptionPublicKey: KeyLike;
let loadedKey: LoadedAuthCredentialKey;
let now: number;
let service: AuthCredentialService;

beforeAll(async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2_048,
  });
  const exportedPublicJwk = await exportJWK(publicKey);
  encryptionPublicKey = publicKey;
  loadedKey = {
    kid: KEY_ID,
    privateKey,
    publicJwk: {
      ...exportedPublicJwk,
      alg: "RSA-OAEP-256",
      kid: KEY_ID,
      use: "enc",
    } as LoadedAuthCredentialKey["publicJwk"],
  };
});

beforeEach(() => {
  now = START_TIME;
  service = createService();
});

describe("AuthCredentialError", () => {
  it("uses stable Chinese messages for every credential error code", () => {
    const messages: Record<AuthCredentialErrorCode, string> = {
      credential_challenge_expired: "加密凭据已过期，请重新提交",
      credential_challenge_reused: "加密凭据已使用，请重新提交",
      credential_invalid: "加密凭据无效，请重新提交",
      credential_key_unknown: "加密凭据密钥已更新，请重新提交",
      credential_required: "请提供加密凭据",
      credential_service_unavailable: "安全凭据服务未正确配置，请联系管理员",
      plaintext_credential_forbidden: "认证请求不得包含明文密码或验证码",
    };

    for (const [code, message] of Object.entries(messages)) {
      expect(new AuthCredentialError(code as AuthCredentialErrorCode).message).toBe(message);
    }
  });
});

describe("AuthCredentialService.issueChallenge", () => {
  it("issues a 60-second HS256 challenge with a random 256-bit jti", async () => {
    const randomJtiService = new AuthCredentialService({
      hashSecret: HASH_SECRET,
      key: loadedKey,
      now: () => now,
      replayStore: new InMemoryAuthCredentialReplayStore(() => now),
    });

    const result = await randomJtiService.issueChallenge("login");
    const protectedHeader = decodeProtectedHeader(result.challenge);
    const verified = await jwtVerify(
      result.challenge,
      encoder.encode(HASH_SECRET),
      {
        algorithms: ["HS256"],
        currentDate: new Date(now),
        typ: "nexus-auth-challenge+jwt",
      },
    );

    expect(result).toMatchObject({
      algorithm: "RSA-OAEP-256",
      expiresAt: now + 60_000,
      key: loadedKey.publicJwk,
    });
    expect(protectedHeader).toEqual({
      alg: "HS256",
      typ: "nexus-auth-challenge+jwt",
    });
    expect(verified.payload).toMatchObject({
      exp: (now + 60_000) / 1_000,
      iat: now / 1_000,
      purpose: "login",
    });
    expect(typeof verified.payload.jti).toBe("string");
    expect(Buffer.from(verified.payload.jti as string, "base64url")).toHaveLength(32);
  });

  it.each([
    "   ",
    "x".repeat(31),
  ])("rejects a signing secret shorter than 32 UTF-8 bytes", (hashSecret) => {
    expect(() => new AuthCredentialService({
      hashSecret,
      key: loadedKey,
      replayStore: new InMemoryAuthCredentialReplayStore(),
    })).toThrowError(AuthCredentialError);

    try {
      new AuthCredentialService({
        hashSecret,
        key: loadedKey,
        replayStore: new InMemoryAuthCredentialReplayStore(),
      });
    } catch (error) {
      expect(error).toMatchObject({ code: "credential_service_unavailable" });
    }
  });

  it("counts signing-secret length in UTF-8 bytes", async () => {
    const multibyteSecret = "密".repeat(11);
    const multibyteService = new AuthCredentialService({
      hashSecret: multibyteSecret,
      key: loadedKey,
      now: () => now,
      replayStore: new InMemoryAuthCredentialReplayStore(() => now),
    });

    await expect(multibyteService.issueChallenge("login")).resolves.toMatchObject({
      algorithm: "RSA-OAEP-256",
    });
  });

  it("returns only explicit public RSA JWK members", async () => {
    const keyWithPrivateMember = {
      ...loadedKey,
      publicJwk: {
        ...loadedKey.publicJwk,
        d: "injected-private-member",
        key_ops: ["decrypt"],
      },
    } as LoadedAuthCredentialKey;
    const projectionService = new AuthCredentialService({
      hashSecret: HASH_SECRET,
      key: keyWithPrivateMember,
      now: () => now,
      replayStore: new InMemoryAuthCredentialReplayStore(() => now),
    });

    const issued = await projectionService.issueChallenge("login");

    expect(issued.key).toEqual({
      alg: "RSA-OAEP-256",
      e: loadedKey.publicJwk.e,
      kid: KEY_ID,
      kty: "RSA",
      n: loadedKey.publicJwk.n,
      use: "enc",
    });
    expect(issued.key).not.toHaveProperty("d");
    expect(issued.key).not.toHaveProperty("key_ops");
  });

  it.each([
    { label: "modulus", override: { n: undefined } },
    { label: "exponent", override: { e: undefined } },
    { label: "RSA key type", override: { kty: "EC" } },
  ])("rejects a public key with an invalid $label", ({ override }) => {
    const invalidKey = {
      ...loadedKey,
      publicJwk: { ...loadedKey.publicJwk, ...override },
    } as LoadedAuthCredentialKey;

    expect(() => new AuthCredentialService({
      hashSecret: HASH_SECRET,
      key: invalidKey,
      replayStore: new InMemoryAuthCredentialReplayStore(),
    })).toThrowError(AuthCredentialError);

    try {
      new AuthCredentialService({
        hashSecret: HASH_SECRET,
        key: invalidKey,
        replayStore: new InMemoryAuthCredentialReplayStore(),
      });
    } catch (error) {
      expect(error).toMatchObject({ code: "credential_service_unavailable" });
    }
  });

  it("uses the injected jti factory for deterministic challenges", async () => {
    const deterministicService = new AuthCredentialService({
      hashSecret: HASH_SECRET,
      jtiFactory: () => "deterministic-test-jti",
      key: loadedKey,
      now: () => now,
      replayStore: new InMemoryAuthCredentialReplayStore(() => now),
    });

    const issued = await deterministicService.issueChallenge("login");
    const verified = await jwtVerify(issued.challenge, encoder.encode(HASH_SECRET), {
      algorithms: ["HS256"],
      currentDate: new Date(now),
      typ: "nexus-auth-challenge+jwt",
    });

    expect(verified.payload.jti).toBe("deterministic-test-jti");
  });
});

describe("AuthCredentialService.decrypt", () => {
  const validCases: Array<{
    expected: { code?: string; password?: string };
    purpose: AuthCredentialPurpose;
    secrets: Record<string, unknown>;
  }> = [
    {
      expected: { password: "login-password" },
      purpose: "login",
      secrets: { password: "login-password" },
    },
    {
      expected: { password: "register-password" },
      purpose: "register",
      secrets: { password: "register-password" },
    },
    {
      expected: { code: "123456" },
      purpose: "verify-email",
      secrets: { code: "123456" },
    },
    {
      expected: { code: "654321", password: "reset-password" },
      purpose: "reset-password",
      secrets: { code: "654321", password: "reset-password" },
    },
  ];

  it.each(validCases)("decrypts a valid $purpose credential", async ({
    expected,
    purpose,
    secrets,
  }) => {
    const credential = await createCredential({
      innerEmail: "user@example.com",
      purpose,
      secrets,
    });

    await expect(service.decrypt({
      credential,
      email: " USER@EXAMPLE.COM ",
      payload: { credential, email: " USER@EXAMPLE.COM " },
      purpose,
    })).resolves.toEqual(expected);
  });

  it.each(["password", "code"])(
    "rejects an outer plaintext %s field before processing the credential",
    async (field) => {
      const error = await captureCredentialError(service.decrypt({
        credential: "not-processed",
        email: "user@example.com",
        payload: { [field]: "plaintext-secret" },
        purpose: "login",
      }));

      expect(error.code).toBe("plaintext_credential_forbidden");
    },
  );

  it("distinguishes a missing credential from a nonstring credential", async () => {
    const missing = await captureCredentialError(service.decrypt({
      credential: undefined,
      email: "user@example.com",
      payload: {},
      purpose: "login",
    }));
    const invalid = await captureCredentialError(service.decrypt({
      credential: 42,
      email: "user@example.com",
      payload: {},
      purpose: "login",
    }));

    expect(missing.code).toBe("credential_required");
    expect(invalid.code).toBe("credential_invalid");
  });

  it("rejects tampered ciphertext", async () => {
    const credential = await createCredential({
      purpose: "login",
      secrets: { password: "tamper-test-password" },
    });

    const error = await captureCredentialError(service.decrypt({
      credential: tamperCiphertext(credential),
      email: "user@example.com",
      payload: {},
      purpose: "login",
    }));

    expect(error.code).toBe("credential_invalid");
  });

  it("rejects an unknown key id before decryption", async () => {
    const credential = await createCredential({
      header: { kid: "retired-key" },
      purpose: "login",
      secrets: { password: "unknown-key-password" },
    });

    const error = await captureCredentialError(service.decrypt({
      credential,
      email: "user@example.com",
      payload: {},
      purpose: "login",
    }));

    expect(error.code).toBe("credential_key_unknown");
  });

  it.each([
    { header: { alg: "RSA-OAEP" }, label: "alg" },
    { header: { enc: "A128GCM" }, label: "enc" },
    { header: { typ: "application/jwe" }, label: "typ" },
    { header: { cty: "json" }, label: "extra protected header" },
  ])("rejects a wrong JWE $label", async ({ header }) => {
    const credential = await createCredential({
      header,
      purpose: "login",
      secrets: { password: "wrong-header-password" },
    });

    const error = await captureCredentialError(service.decrypt({
      credential,
      email: "user@example.com",
      payload: {},
      purpose: "login",
    }));

    expect(error.code).toBe("credential_invalid");
  });

  it.each([
    {
      challengePurpose: "login" as const,
      innerPurpose: "register" as const,
      label: "payload",
    },
    {
      challengePurpose: "register" as const,
      innerPurpose: "login" as const,
      label: "challenge",
    },
  ])("rejects a purpose mismatch in the $label", async ({
    challengePurpose,
    innerPurpose,
  }) => {
    const credential = await createCredential({
      challengePurpose,
      purpose: innerPurpose,
      secrets: { password: "purpose-mismatch-password" },
    });

    const error = await captureCredentialError(service.decrypt({
      credential,
      email: "user@example.com",
      payload: {},
      purpose: "login",
    }));

    expect(error.code).toBe("credential_invalid");
  });

  it("rejects a mismatch between normalized inner and outer email", async () => {
    const credential = await createCredential({
      innerEmail: "other@example.com",
      purpose: "login",
      secrets: { password: "email-mismatch-password" },
    });

    const error = await captureCredentialError(service.decrypt({
      credential,
      email: "user@example.com",
      payload: {},
      purpose: "login",
    }));

    expect(error.code).toBe("credential_invalid");
  });

  it.each([
    { label: "missing password", purpose: "login" as const, secrets: {} },
    {
      label: "extra sensitive field",
      purpose: "login" as const,
      secrets: { code: "123456", password: "password" },
    },
    {
      label: "wrong sensitive type",
      purpose: "verify-email" as const,
      secrets: { code: 123456 },
    },
    {
      label: "unknown field",
      purpose: "login" as const,
      secrets: { nonce: "unexpected", password: "password" },
    },
    {
      label: "missing reset password",
      purpose: "reset-password" as const,
      secrets: { code: "123456" },
    },
  ])("rejects a payload with $label", async ({ purpose, secrets }) => {
    const credential = await createCredential({ purpose, secrets });

    const error = await captureCredentialError(service.decrypt({
      credential,
      email: "user@example.com",
      payload: {},
      purpose,
    }));

    expect(error.code).toBe("credential_invalid");
  });

  it("reports an expired signed challenge distinctly", async () => {
    const credential = await createCredential({
      purpose: "login",
      secrets: { password: "expired-password" },
    });
    now += 60_001;

    const error = await captureCredentialError(service.decrypt({
      credential,
      email: "user@example.com",
      payload: {},
      purpose: "login",
    }));

    expect(error.code).toBe("credential_challenge_expired");
  });

  it("rechecks expiry immediately before replay consumption", async () => {
    const credential = await createCredential({
      purpose: "login",
      secrets: { password: "pre-consume-expiry-password" },
    });
    const consume = vi.fn().mockResolvedValue(true);
    const clock = vi.fn()
      .mockReturnValueOnce(START_TIME + 59_999)
      .mockReturnValue(START_TIME + 60_000);
    service = createService({ consume }, clock);

    const error = await captureCredentialError(service.decrypt({
      credential,
      email: "user@example.com",
      payload: {},
      purpose: "login",
    }));

    expect(error.code).toBe("credential_challenge_expired");
    expect(consume).not.toHaveBeenCalled();
  });

  it("does not return credentials when expiry occurs during successful replay consumption", async () => {
    const credential = await createCredential({
      purpose: "login",
      secrets: { password: "post-consume-expiry-password" },
    });
    now = START_TIME + 59_999;
    const consume = vi.fn(async () => {
      now = START_TIME + 60_000;
      return true;
    });
    service = createService({ consume });

    const error = await captureCredentialError(service.decrypt({
      credential,
      email: "user@example.com",
      payload: {},
      purpose: "login",
    }));

    expect(error.code).toBe("credential_challenge_expired");
    expect(consume).toHaveBeenCalledOnce();
  });

  it("reports expiry instead of reuse when replay consumption returns false at expiry", async () => {
    const credential = await createCredential({
      purpose: "login",
      secrets: { password: "false-at-expiry-password" },
    });
    now = START_TIME + 59_999;
    const consume = vi.fn(async () => {
      now = START_TIME + 60_000;
      return false;
    });
    service = createService({ consume });

    const error = await captureCredentialError(service.decrypt({
      credential,
      email: "user@example.com",
      payload: {},
      purpose: "login",
    }));

    expect(error.code).toBe("credential_challenge_expired");
    expect(consume).toHaveBeenCalledOnce();
  });

  it("consumes a valid challenge exactly once", async () => {
    const credential = await createCredential({
      purpose: "login",
      secrets: { password: "single-use-password" },
    });
    const input = {
      credential,
      email: "user@example.com",
      payload: {},
      purpose: "login" as const,
    };

    await expect(service.decrypt(input)).resolves.toEqual({
      password: "single-use-password",
    });
    const error = await captureCredentialError(service.decrypt(input));

    expect(error.code).toBe("credential_challenge_reused");
  });

  it("maps replay-store failures to credential service unavailable", async () => {
    service = createService({
      consume: async () => {
        throw new AuthCredentialServiceUnavailableError();
      },
    });
    const credential = await createCredential({
      purpose: "login",
      secrets: { password: "store-failure-password" },
    });

    const error = await captureCredentialError(service.decrypt({
      credential,
      email: "user@example.com",
      payload: {},
      purpose: "login",
    }));

    expect(error.code).toBe("credential_service_unavailable");
  });

  it("never includes decrypted secret text in credential errors", async () => {
    const secret = "secret-value-must-not-leak";
    const credential = await createCredential({
      innerEmail: "other@example.com",
      purpose: "login",
      secrets: { password: secret },
    });

    const error = await captureCredentialError(service.decrypt({
      credential,
      email: "user@example.com",
      payload: {},
      purpose: "login",
    }));
    const renderedError = [error.message, error.stack, JSON.stringify(error)].join("\n");

    expect(renderedError).not.toContain(secret);
  });
});

function createService(
  replayStore: AuthCredentialReplayStore = new InMemoryAuthCredentialReplayStore(() => now),
  clock: () => number = () => now,
) {
  return new AuthCredentialService({
    hashSecret: HASH_SECRET,
    jtiFactory: () => TEST_JTI,
    key: loadedKey,
    now: clock,
    replayStore,
  });
}

async function createCredential({
  challengePurpose,
  header = {},
  innerEmail = "user@example.com",
  purpose,
  secrets,
}: {
  challengePurpose?: AuthCredentialPurpose;
  header?: Partial<{
    alg: string;
    cty: string;
    enc: string;
    kid: string;
    typ: string;
  }>;
  innerEmail?: string;
  purpose: AuthCredentialPurpose;
  secrets: Record<string, unknown>;
}) {
  const issued = await service.issueChallenge(challengePurpose ?? purpose);
  const plaintext = encoder.encode(JSON.stringify({
    version: 1,
    purpose,
    email: innerEmail,
    challenge: issued.challenge,
    ...secrets,
  }));

  return new CompactEncrypt(plaintext)
    .setProtectedHeader({
      alg: "RSA-OAEP-256",
      enc: "A256GCM",
      kid: KEY_ID,
      typ: "nexus-auth+jwe",
      ...header,
    })
    .encrypt(encryptionPublicKey);
}

async function captureCredentialError(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AuthCredentialError);
    return error as AuthCredentialError;
  }
  throw new Error("Expected an AuthCredentialError");
}

function tamperCiphertext(credential: string) {
  const segments = credential.split(".");
  const ciphertext = segments[3];
  segments[3] = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
  return segments.join(".");
}
