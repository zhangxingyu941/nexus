export const AUTH_CREDENTIAL_PURPOSES = [
  "login",
  "register",
  "verify-email",
  "reset-password",
] as const;

export type AuthCredentialPurpose = typeof AUTH_CREDENTIAL_PURPOSES[number];

export interface AuthCredentialChallengeResponse {
  algorithm: "RSA-OAEP-256";
  challenge: string;
  expiresAt: number;
  key: JsonWebKey & { kid: string };
}

export type AuthCredentialErrorCode =
  | "credential_required"
  | "plaintext_credential_forbidden"
  | "credential_invalid"
  | "credential_key_unknown"
  | "credential_challenge_expired"
  | "credential_challenge_reused"
  | "credential_service_unavailable";
