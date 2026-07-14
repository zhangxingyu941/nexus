import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, type APIRequestContext } from "@playwright/test";

const projectRoot = resolve(import.meta.dirname, "..");
const captureFile = "/app/server/data/uploads/auth-mail-capture.jsonl";

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
  const registration = await request.post("/api/auth/register", {
    data: {
      displayName: identity.displayName,
      email: identity.email,
      password: identity.password,
    },
  });
  expect(registration.status()).toBe(201);
  const code = await waitForCapturedCode(identity.email, "verify-email");
  const verification = await request.post("/api/auth/verify-email", {
    data: { code, email: identity.email },
  });
  expect(verification.ok()).toBe(true);
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
    "DELETE FROM auth_audit_events WHERE user_id IN (SELECT id FROM app_users WHERE email LIKE 'e2e-%@example.com' OR email LIKE 'collab-%@example.com'); DELETE FROM editor_workspaces WHERE owner_id IN (SELECT id FROM app_users WHERE email LIKE 'e2e-%@example.com' OR email LIKE 'collab-%@example.com'); DELETE FROM app_users WHERE email LIKE 'e2e-%@example.com' OR email LIKE 'collab-%@example.com';",
  ]);
  dockerCompose([
    "exec",
    "-T",
    "redis",
    "redis-cli",
    "EVAL",
    "local keys = redis.call('KEYS', ARGV[1]); if #keys == 0 then return 0 end; return redis.call('DEL', unpack(keys))",
    "0",
    "notion-editor:auth-rate:*",
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
    .map((line) => JSON.parse(line) as {
      code: string;
      purpose: "reset-password" | "verify-email";
      to: string;
    });
}

function dockerCompose(args: string[]) {
  return execFileSync(process.env.DOCKER_EXE ?? "docker", ["compose", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
  });
}
