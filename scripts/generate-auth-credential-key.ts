import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_PRIVATE_KEY_FILE = ".secrets/auth-credential-private.pem";

export async function generateAuthCredentialKey({
  cwd = process.cwd(),
  outputFile = DEFAULT_PRIVATE_KEY_FILE,
}: {
  cwd?: string;
  outputFile?: string;
} = {}) {
  const absolutePath = resolve(cwd, outputFile);
  await mkdir(dirname(absolutePath), { recursive: true });

  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 3072,
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "der", type: "spki" },
  });
  const fingerprint = createHash("sha256")
    .update(publicKey)
    .digest("base64url")
    .slice(0, 20);
  const kid = `auth-${fingerprint}`;

  await writeFile(absolutePath, privateKey, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  return {
    filePath: isAbsolute(outputFile) ? outputFile : outputFile.replace(/\\/g, "/"),
    kid,
  };
}

async function main() {
  const generated = await generateAuthCredentialKey();
  process.stdout.write([
    `AUTH_CREDENTIAL_KEY_ID=${generated.kid}`,
    `AUTH_CREDENTIAL_PRIVATE_KEY_FILE=${generated.filePath}`,
    "",
  ].join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Key generation failed"}\n`);
    process.exitCode = 1;
  });
}
