import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthCredentialServiceUnavailableError } from "./authCredentialReplayStore";
import { AuthCredentialError } from "./authCredentialService";
import {
  getAuthCredentialDecryptor,
  getAuthCredentialService,
} from "./authCredentialServices";

const ENVIRONMENT_KEYS = [
  "AUTH_CREDENTIAL_KEY_ID",
  "AUTH_CREDENTIAL_PRIVATE_KEY_FILE",
  "AUTH_HASH_SECRET",
  "NODE_ENV",
  "REDIS_URL",
] as const;
const originalEnvironment = Object.fromEntries(
  ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
);

describe("getAuthCredentialService", () => {
  let privateKeyPem: string;
  let privateKeyFile: string;
  let temporaryDirectory: string;

  beforeAll(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "auth-credential-services-"));
    privateKeyFile = join(temporaryDirectory, "private.pem");
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
    privateKeyPem = privateKey;
    await writeFile(privateKeyFile, privateKeyPem, "utf8");
  });

  afterEach(() => {
    for (const key of ENVIRONMENT_KEYS) {
      const value = originalEnvironment[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        Reflect.set(process.env, key, value);
      }
    }
  });

  afterAll(async () => {
    await rm(temporaryDirectory, { force: true, recursive: true });
  });

  it("shares one pending service for an equivalent absolute key configuration", async () => {
    configureEnvironment(relative(process.cwd(), privateKeyFile));

    const first = getAuthCredentialService();
    process.env.AUTH_CREDENTIAL_PRIVATE_KEY_FILE = privateKeyFile;
    const second = getAuthCredentialService();

    expect(second).toBe(first);
    await expect(second).resolves.toBe(await first);

    process.env.AUTH_CREDENTIAL_KEY_ID = "auth-test-rotated";
    const rotated = getAuthCredentialService();
    expect(rotated).not.toBe(first);
    await expect(rotated).resolves.toBeDefined();

    process.env.AUTH_CREDENTIAL_KEY_ID = "auth-test";
    const switchedBack = getAuthCredentialService();
    expect(switchedBack).not.toBe(first);
    expect(switchedBack).not.toBe(rotated);
    await expect(switchedBack).resolves.toBeDefined();
  });

  it("requires an explicitly configured 32-byte AUTH_HASH_SECRET", async () => {
    configureEnvironment(privateKeyFile);
    delete process.env.AUTH_HASH_SECRET;

    await expect(getAuthCredentialService())
      .rejects.toBeInstanceOf(AuthCredentialServiceUnavailableError);

    process.env.AUTH_HASH_SECRET = "x".repeat(31);
    await expect(getAuthCredentialService())
      .rejects.toBeInstanceOf(AuthCredentialServiceUnavailableError);
  });

  it("clears a failed initialization so the same configuration can recover", async () => {
    const recoveredKeyFile = join(temporaryDirectory, "recovered.pem");
    configureEnvironment(recoveredKeyFile);

    const failed = getAuthCredentialService();
    await expect(failed).rejects.toThrow("AUTH_CREDENTIAL_PRIVATE_KEY_FILE");

    await writeFile(recoveredKeyFile, privateKeyPem, "utf8");
    const recovered = getAuthCredentialService();

    expect(recovered).not.toBe(failed);
    await expect(recovered).resolves.toBeDefined();
  });
});

describe("getAuthCredentialDecryptor", () => {
  const input = {
    credential: "test-jwe",
    email: "linxia@example.com",
    payload: { credential: "test-jwe", email: "linxia@example.com" },
    purpose: "login" as const,
  };

  it("does not initialize the credential service until decrypt is called", async () => {
    const decrypt = vi.fn().mockResolvedValue({ password: "temporary plaintext" });
    const getService = vi.fn().mockResolvedValue({ decrypt });

    const credentials = getAuthCredentialDecryptor(getService);

    expect(getService).not.toHaveBeenCalled();
    await expect(credentials.decrypt(input)).resolves.toEqual({
      password: "temporary plaintext",
    });
    expect(getService).toHaveBeenCalledOnce();
    expect(decrypt).toHaveBeenCalledWith(input);
  });

  it("converts credential service setup failures to service unavailable", async () => {
    const internalError = new Error("private key path and Redis details");
    const getService = vi.fn().mockRejectedValue(internalError);
    const credentials = getAuthCredentialDecryptor(getService);

    const rejection = credentials.decrypt(input);

    await expect(rejection).rejects.toBeInstanceOf(
      AuthCredentialServiceUnavailableError,
    );
    await expect(rejection).rejects.not.toBe(internalError);
  });

  it("preserves AuthCredentialError thrown by service decrypt", async () => {
    const credentialError = new AuthCredentialError("credential_invalid");
    const decrypt = vi.fn().mockRejectedValue(credentialError);
    const credentials = getAuthCredentialDecryptor(
      vi.fn().mockResolvedValue({ decrypt }),
    );

    await expect(credentials.decrypt(input)).rejects.toBe(credentialError);
  });
});

function configureEnvironment(privateKeyFile: string) {
  process.env.AUTH_CREDENTIAL_KEY_ID = "auth-test";
  process.env.AUTH_CREDENTIAL_PRIVATE_KEY_FILE = privateKeyFile;
  process.env.AUTH_HASH_SECRET = "test-auth-hash-secret-at-least-32-bytes";
  Reflect.set(process.env, "NODE_ENV", "test");
  delete process.env.REDIS_URL;
}
