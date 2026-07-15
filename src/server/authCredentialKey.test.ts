import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAuthCredentialKey } from "./authCredentialKey";

describe("loadAuthCredentialKey", () => {
  let privateKeyFile: string;
  let temporaryDirectory: string;

  beforeAll(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "auth-credential-key-"));
    privateKeyFile = join(temporaryDirectory, "private.pem");
    await writeFile(privateKeyFile, createRsaPrivateKey("pkcs8"), "utf8");
  });

  afterAll(async () => {
    await rm(temporaryDirectory, { force: true, recursive: true });
  });

  it("rejects a missing key id", async () => {
    await expect(loadAuthCredentialKey({
      cwd: temporaryDirectory,
      environment: { AUTH_CREDENTIAL_PRIVATE_KEY_FILE: "private.pem" },
    })).rejects.toThrow("AUTH_CREDENTIAL_KEY_ID");
  });

  it("rejects an unsafe key id", async () => {
    await expect(loadAuthCredentialKey({
      cwd: temporaryDirectory,
      environment: {
        AUTH_CREDENTIAL_KEY_ID: "auth key/id",
        AUTH_CREDENTIAL_PRIVATE_KEY_FILE: "private.pem",
      },
    })).rejects.toThrow("AUTH_CREDENTIAL_KEY_ID");
  });

  it("rejects a missing private-key path", async () => {
    await expect(loadAuthCredentialKey({
      cwd: temporaryDirectory,
      environment: { AUTH_CREDENTIAL_KEY_ID: "auth-test" },
    })).rejects.toThrow("AUTH_CREDENTIAL_PRIVATE_KEY_FILE");
  });

  it("rejects an absent private-key file", async () => {
    await expect(loadAuthCredentialKey({
      cwd: temporaryDirectory,
      environment: {
        AUTH_CREDENTIAL_KEY_ID: "auth-test",
        AUTH_CREDENTIAL_PRIVATE_KEY_FILE: "absent.pem",
      },
    })).rejects.toThrow("absent.pem");
  });

  it("rejects malformed private-key content", async () => {
    const malformedFile = join(temporaryDirectory, "malformed.pem");
    await writeFile(malformedFile, "not a private key", "utf8");

    await expect(loadAuthCredentialKey({
      cwd: temporaryDirectory,
      environment: configuredEnvironment("malformed.pem"),
    })).rejects.toThrow("PKCS#8");
  });

  it("rejects a non-PKCS8 RSA private key", async () => {
    const pkcs1File = join(temporaryDirectory, "pkcs1.pem");
    await writeFile(pkcs1File, createRsaPrivateKey("pkcs1"), "utf8");

    await expect(loadAuthCredentialKey({
      cwd: temporaryDirectory,
      environment: configuredEnvironment("pkcs1.pem"),
    })).rejects.toThrow("PKCS#8");
  });

  it("rejects a non-RSA PKCS8 private key", async () => {
    const ecFile = join(temporaryDirectory, "ec.pem");
    const { privateKey } = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
    await writeFile(ecFile, privateKey, "utf8");

    await expect(loadAuthCredentialKey({
      cwd: temporaryDirectory,
      environment: configuredEnvironment("ec.pem"),
    })).rejects.toThrow("RSA");
  });

  it("imports the decryption key and derives a public encryption JWK", async () => {
    const loaded = await loadAuthCredentialKey({
      cwd: temporaryDirectory,
      environment: configuredEnvironment("private.pem"),
    });

    expect(loaded.kid).toBe("auth-test");
    expect(loaded.privateKey).toBeDefined();
    expect(loaded.publicJwk).toMatchObject({
      alg: "RSA-OAEP-256",
      kid: "auth-test",
      kty: "RSA",
      use: "enc",
    });
    expect(loaded.publicJwk).not.toHaveProperty("d");
  });

  it("accepts PKCS8 PEM files with CRLF line endings", async () => {
    const crlfFile = join(temporaryDirectory, "private-crlf.pem");
    await writeFile(crlfFile, createRsaPrivateKey("pkcs8").replace(/\n/g, "\r\n"), "utf8");

    await expect(loadAuthCredentialKey({
      cwd: temporaryDirectory,
      environment: configuredEnvironment("private-crlf.pem"),
    })).resolves.toMatchObject({ kid: "auth-test" });
  });

  it("includes the key id in the cache identity", async () => {
    const first = await loadAuthCredentialKey({
      cwd: temporaryDirectory,
      environment: configuredEnvironment("private.pem", "auth-test-first"),
    });
    const second = await loadAuthCredentialKey({
      cwd: temporaryDirectory,
      environment: configuredEnvironment("private.pem", "auth-test-second"),
    });

    expect(first).not.toBe(second);
    expect(second.publicJwk.kid).toBe("auth-test-second");
  });
});

function configuredEnvironment(file: string, kid = "auth-test") {
  return {
    AUTH_CREDENTIAL_KEY_ID: kid,
    AUTH_CREDENTIAL_PRIVATE_KEY_FILE: file,
  };
}

function createRsaPrivateKey(type: "pkcs1" | "pkcs8") {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { format: "pem", type },
    publicKeyEncoding: { format: "pem", type: "spki" },
  }).privateKey;
}
