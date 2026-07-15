import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exportJWK, importPKCS8, type KeyLike } from "jose";

const ALGORITHM = "RSA-OAEP-256" as const;
const SAFE_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type ReadFile = (path: string, encoding: "utf8") => Promise<string>;

export interface LoadAuthCredentialKeyOptions {
  cwd?: string;
  environment?: Record<string, string | undefined>;
  readFile?: ReadFile;
}

export interface LoadedAuthCredentialKey {
  kid: string;
  privateKey: KeyLike;
  publicJwk: JsonWebKey & {
    alg: typeof ALGORITHM;
    kid: string;
    use: "enc";
  };
}

const keyCache = new Map<string, Promise<LoadedAuthCredentialKey>>();

export async function loadAuthCredentialKey(
  options: LoadAuthCredentialKeyOptions = {},
): Promise<LoadedAuthCredentialKey> {
  const environment = options.environment ?? process.env;
  const kid = environment.AUTH_CREDENTIAL_KEY_ID?.trim();
  if (!kid || !SAFE_KEY_ID.test(kid)) {
    throw new Error("AUTH_CREDENTIAL_KEY_ID must be a nonempty safe key id");
  }

  const configuredPath = environment.AUTH_CREDENTIAL_PRIVATE_KEY_FILE?.trim();
  const inlinePem = environment.AUTH_CREDENTIAL_PRIVATE_KEY_PEM?.trim();
  if (!configuredPath && !inlinePem) {
    throw new Error("AUTH_CREDENTIAL_PRIVATE_KEY_FILE or AUTH_CREDENTIAL_PRIVATE_KEY_PEM is required");
  }

  const absolutePath = configuredPath
    ? resolve(options.cwd ?? process.cwd(), configuredPath)
    : "(inline-pem)";
  const cacheKey = JSON.stringify([kid, absolutePath]);
  const canCache = options.readFile === undefined;
  if (canCache) {
    const cached = keyCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const pending = readAndImportKey(
    kid,
    absolutePath,
    inlinePem,
    options.readFile ?? readFile,
  );
  if (!canCache) {
    return pending;
  }

  keyCache.set(cacheKey, pending);
  try {
    return await pending;
  } catch (error) {
    keyCache.delete(cacheKey);
    throw error;
  }
}

async function readAndImportKey(
  kid: string,
  absolutePath: string,
  inlinePem: string | undefined,
  readPrivateKeyFile: ReadFile,
): Promise<LoadedAuthCredentialKey> {
  let pem: string;
  if (inlinePem) {
    pem = inlinePem;
  } else {
    try {
      pem = await readPrivateKeyFile(absolutePath, "utf8");
    } catch {
      throw new Error(`Unable to read AUTH_CREDENTIAL_PRIVATE_KEY_FILE: ${absolutePath}`);
    }
  }

  if (!isPkcs8Pem(pem)) {
    throw new Error("AUTH_CREDENTIAL_PRIVATE_KEY_FILE must contain a PKCS#8 PEM private key");
  }

  let parsedPrivateKey;
  try {
    parsedPrivateKey = createPrivateKey(pem);
  } catch {
    throw new Error("AUTH_CREDENTIAL_PRIVATE_KEY_FILE must contain a valid PKCS#8 PEM private key");
  }
  if (parsedPrivateKey.asymmetricKeyType !== "rsa") {
    throw new Error("AUTH_CREDENTIAL_PRIVATE_KEY_FILE must contain an RSA private key");
  }

  const publicKey = createPublicKey(parsedPrivateKey);
  let privateKey: KeyLike;
  try {
    privateKey = await importPKCS8(pem, ALGORITHM);
  } catch {
    throw new Error("AUTH_CREDENTIAL_PRIVATE_KEY_FILE must contain a valid RSA PKCS#8 private key");
  }
  const exportedPublicJwk = await exportJWK(publicKey);
  const publicJwk = {
    ...exportedPublicJwk,
    alg: ALGORITHM,
    kid,
    use: "enc" as const,
  } as LoadedAuthCredentialKey["publicJwk"];

  return { kid, privateKey, publicJwk };
}

function isPkcs8Pem(value: string) {
  return /^-----BEGIN PRIVATE KEY-----\r?\n[\s\S]+\r?\n-----END PRIVATE KEY-----$/
    .test(value.trim());
}
