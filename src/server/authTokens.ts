import { createHmac, randomInt } from "node:crypto";

export type AuthTokenPurpose = "reset-password" | "verify-email";

export function createAuthCode(codeFactory: () => string = () => randomInt(0, 1_000_000).toString().padStart(6, "0")) {
  const code = codeFactory();
  if (!/^\d{6}$/.test(code)) {
    throw new Error("验证码必须是 6 位数字");
  }
  return code;
}

export function hashAuthCode({
  code,
  hashSecret,
  purpose,
  userId,
}: {
  code: string;
  hashSecret: string;
  purpose: AuthTokenPurpose;
  userId: string;
}) {
  if (!hashSecret.trim()) {
    throw new Error("AUTH_HASH_SECRET 未配置");
  }
  return createHmac("sha256", hashSecret)
    .update(`${userId}:${purpose}:${code}`)
    .digest("hex");
}
