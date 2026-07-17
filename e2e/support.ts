import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from "@playwright/test";
import { CompactEncrypt, importJWK, type JWK } from "jose";

const projectRoot = resolve(import.meta.dirname, "..");
const captureFile = "/app/server/data/uploads/auth-mail-capture.jsonl";
const authEndpoints = {
  login: "/api/auth/session",
  register: "/api/auth/register",
  "reset-password": "/api/auth/password/reset",
  "verify-email": "/api/auth/verify-email",
} as const;

type EncryptedAuthApiInput = { email: string } & (
  | { purpose: "login"; secrets: { password: string } }
  | { displayName: string; purpose: "register"; secrets: { password: string } }
  | { purpose: "reset-password"; secrets: { code: string; password: string } }
  | { purpose: "verify-email"; secrets: { code: string } }
);

type MailCapture =
  | {
      code: string;
      purpose: "reset-password" | "verify-email";
      to: string;
    }
  | {
      purpose: "workspace-invite";
      to: string;
      url?: string;
    };

export function createAcceptanceIdentity(prefix: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    displayName: `${prefix} User`,
    email: `${prefix}-${suffix}@example.com`,
    password: "Acceptance-pass-12345!",
    replacementPassword: "Replacement-pass-67890!",
  };
}

export async function registerAndVerify(
  request: APIRequestContext,
  identity: ReturnType<typeof createAcceptanceIdentity>,
) {
  const registration = await requestEncryptedAuthApi(request, {
    displayName: identity.displayName,
    email: identity.email,
    purpose: "register",
    secrets: { password: identity.password },
  });
  expect(registration.status()).toBe(201);
  const code = await waitForCapturedCode(identity.email, "verify-email");
  const verification = await requestEncryptedAuthApi(request, {
    email: identity.email,
    purpose: "verify-email",
    secrets: { code },
  });
  expect(verification.ok()).toBe(true);
}

export async function requestEncryptedAuthApi(
  request: APIRequestContext,
  input: EncryptedAuthApiInput,
): Promise<APIResponse> {
  const email = input.email.trim().toLowerCase();
  const challengeResponse = await request.post("/api/auth/credential-challenge", {
    data: { purpose: input.purpose },
  });
  expect(challengeResponse.ok(), "credential challenge request failed").toBe(true);
  const challenge = parseCredentialChallenge(await challengeResponse.json());
  const publicKey = await importJWK(challenge.key, "RSA-OAEP-256");
  const credential = await new CompactEncrypt(new TextEncoder().encode(JSON.stringify({
    version: 1,
    purpose: input.purpose,
    email,
    challenge: challenge.challenge,
    ...input.secrets,
  })))
    .setProtectedHeader({
      alg: "RSA-OAEP-256",
      enc: "A256GCM",
      kid: challenge.key.kid,
      typ: "nexus-auth+jwe",
    })
    .encrypt(publicKey);
  const data = input.purpose === "register"
    ? { displayName: input.displayName, email, credential }
    : { email, credential };

  return request.post(authEndpoints[input.purpose], { data });
}

export function waitForWorkspaceCatalog(page: Page) {
  return page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "GET"
      && new URL(response.url()).pathname === "/api/workspaces"
      && response.ok();
  });
}

export async function waitForCapturedCode(
  email: string,
  purpose: "reset-password" | "verify-email",
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const captures = readMailCaptures();
    const match = [...captures].reverse().find((capture) =>
      capture.to === email && capture.purpose === purpose,
    );
    if (match) {
      return match.code;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`No captured ${purpose} mail for ${email}`);
}

export async function waitForCapturedInvite(email: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const match = [...readMailCaptures()].reverse().find((capture) =>
      capture.to === email && capture.purpose === "workspace-invite",
    );
    if (match && typeof match.url === "string") return match.url;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("No captured workspace invitation for " + email);
}

export function ageWorkspaceInviteForResend(email: string) {
  updatePendingWorkspaceInvite(
    email,
    "last_delivery_attempt_at = 0, updated_at = 0",
  );
}

export function expireWorkspaceInvite(email: string) {
  updatePendingWorkspaceInvite(email, "expires_at = 0");
}

export function cleanupAcceptanceData() {
  dockerCompose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "postgres",
    "-d",
    "notion_block_editor",
    "-c",
    "DELETE FROM auth_audit_events WHERE user_id IN (SELECT id FROM app_users WHERE email LIKE 'e2e-%@example.com' OR email LIKE 'collab-%@example.com' OR email LIKE 'workspace-%@example.com'); DELETE FROM editor_workspaces WHERE id IN (SELECT members.workspace_id FROM workspace_members members INNER JOIN app_users users ON users.id = members.user_id WHERE members.role = 'owner' AND (users.email LIKE 'e2e-%@example.com' OR users.email LIKE 'collab-%@example.com' OR users.email LIKE 'workspace-%@example.com')); DELETE FROM app_users WHERE email LIKE 'e2e-%@example.com' OR email LIKE 'collab-%@example.com' OR email LIKE 'workspace-%@example.com';",
  ]);
  dockerCompose([
    "exec",
    "-T",
    "redis",
    "redis-cli",
    "EVAL",
    "local keys = {}; for _, pattern in ipairs(ARGV) do for _, key in ipairs(redis.call('KEYS', pattern)) do table.insert(keys, key) end end; if #keys == 0 then return 0 end; return redis.call('DEL', unpack(keys))",
    "0",
    "notion-editor:auth-rate:*",
    "notion-editor:auth-credential:*",
    "notion-editor:workspace-invite-rate:*",
  ]);
  dockerCompose(["exec", "-T", "web", "sh", "-c", `rm -f ${captureFile}`]);
}

export function restartCollaborationService() {
  dockerCompose(["restart", "collaboration"]);
}

function readMailCaptures() {
  const output = dockerCompose([
    "exec",
    "-T",
    "web",
    "sh",
    "-c",
    `cat ${captureFile} 2>/dev/null || true`,
  ]);
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MailCapture);
}

function updatePendingWorkspaceInvite(email: string, assignment: string) {
  const escapedEmail = email.trim().toLowerCase().replaceAll("'", "''");
  const output = dockerCompose([
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "postgres",
    "-d",
    "notion_block_editor",
    "-c",
    `UPDATE workspace_invites SET ${assignment} WHERE id = (SELECT id FROM workspace_invites WHERE email = '${escapedEmail}' AND status = 'pending' ORDER BY created_at DESC LIMIT 1);`,
  ]);
  if (!output.includes("UPDATE 1")) {
    throw new Error(`No pending workspace invitation for ${email}`);
  }
}

function parseCredentialChallenge(payload: unknown) {
  if (
    !isRecord(payload)
    || payload.algorithm !== "RSA-OAEP-256"
    || typeof payload.challenge !== "string"
    || payload.challenge.length === 0
    || typeof payload.expiresAt !== "number"
    || !Number.isFinite(payload.expiresAt)
    || !isRecord(payload.key)
    || payload.key.kty !== "RSA"
    || typeof payload.key.n !== "string"
    || payload.key.n.length === 0
    || typeof payload.key.e !== "string"
    || payload.key.e.length === 0
    || typeof payload.key.kid !== "string"
    || payload.key.kid.length === 0
    || payload.key.alg !== "RSA-OAEP-256"
    || payload.key.use !== "enc"
  ) {
    throw new Error("Credential challenge response is invalid");
  }

  return {
    challenge: payload.challenge,
    key: payload.key as JWK & { kid: string },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dockerCompose(args: string[]) {
  return execFileSync(process.env.DOCKER_EXE ?? "docker", ["compose", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
  });
}
