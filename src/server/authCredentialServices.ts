import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { loadAuthCredentialKey } from "./authCredentialKey";
import {
  AuthCredentialServiceUnavailableError,
  createAuthCredentialReplayStore,
} from "./authCredentialReplayStore";
import { AuthCredentialService } from "./authCredentialService";

const encoder = new TextEncoder();
let sharedService: {
  fingerprint: string;
  promise: Promise<AuthCredentialService>;
} | null = null;

interface AuthCredentialRuntimeConfiguration {
  absoluteKeyPath: string;
  hashSecret: string;
  kid: string;
  production: boolean;
  redisUrl: string | undefined;
}

type AuthCredentialDecryptor = Pick<AuthCredentialService, "decrypt">;
type AuthCredentialServiceFactory = () => Promise<AuthCredentialDecryptor>;

export function getAuthCredentialService(): Promise<AuthCredentialService> {
  let configuration: AuthCredentialRuntimeConfiguration;
  try {
    configuration = loadRuntimeConfiguration();
  } catch (error) {
    return Promise.reject(error);
  }

  const fingerprint = createConfigurationFingerprint(configuration);
  if (sharedService?.fingerprint === fingerprint) {
    return sharedService.promise;
  }

  const pending = createService(configuration);
  sharedService = { fingerprint, promise: pending };
  void pending.catch(() => {
    if (sharedService?.promise === pending) {
      sharedService = null;
    }
  });
  return pending;
}

export function getAuthCredentialDecryptor(
  getService: AuthCredentialServiceFactory = getAuthCredentialService,
): AuthCredentialDecryptor {
  return {
    async decrypt(input) {
      let service: AuthCredentialDecryptor;
      try {
        service = await getService();
      } catch {
        throw new AuthCredentialServiceUnavailableError();
      }
      return service.decrypt(input);
    },
  };
}

function createConfigurationFingerprint(
  configuration: AuthCredentialRuntimeConfiguration,
) {
  return createHash("sha256").update(JSON.stringify([
    configuration.kid,
    configuration.absoluteKeyPath,
    configuration.hashSecret,
    configuration.production,
    configuration.redisUrl ?? null,
  ])).digest("hex");
}

async function createService(configuration: AuthCredentialRuntimeConfiguration) {
  const key = await loadAuthCredentialKey({
    environment: {
      AUTH_CREDENTIAL_KEY_ID: configuration.kid,
      AUTH_CREDENTIAL_PRIVATE_KEY_FILE: configuration.absoluteKeyPath || undefined,
      AUTH_CREDENTIAL_PRIVATE_KEY_PEM: process.env.AUTH_CREDENTIAL_PRIVATE_KEY_PEM?.trim() || undefined,
    },
  });
  const replayStore = createAuthCredentialReplayStore({
    hashSecret: configuration.hashSecret,
    production: configuration.production,
    redisUrl: configuration.redisUrl,
  });
  return new AuthCredentialService({
    hashSecret: configuration.hashSecret,
    key,
    replayStore,
  });
}

function loadRuntimeConfiguration(): AuthCredentialRuntimeConfiguration {
  const hashSecret = process.env.AUTH_HASH_SECRET;
  if (
    !hashSecret?.trim()
    || encoder.encode(hashSecret).byteLength < 32
  ) {
    throw new AuthCredentialServiceUnavailableError();
  }

  const configuredKeyPath = process.env.AUTH_CREDENTIAL_PRIVATE_KEY_FILE?.trim();
  const configuredKeyPem = process.env.AUTH_CREDENTIAL_PRIVATE_KEY_PEM?.trim();
  return {
    absoluteKeyPath: configuredKeyPath
      ? resolve(process.cwd(), configuredKeyPath)
      : configuredKeyPem
        ? "(inline-pem)"
        : "",
    hashSecret,
    kid: process.env.AUTH_CREDENTIAL_KEY_ID?.trim() ?? "",
    production: process.env.NODE_ENV === "production",
    redisUrl: process.env.REDIS_URL?.trim() || undefined,
  };
}
