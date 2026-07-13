import { describe, expect, it } from "vitest";
import { createAuthCode, hashAuthCode } from "./authTokens";

describe("auth code helpers", () => {
  it("creates an exact six-digit code", () => {
    expect(createAuthCode(() => "012345")).toBe("012345");
    expect(() => createAuthCode(() => "12345")).toThrow("验证码必须是 6 位数字");
    expect(() => createAuthCode(() => "abcdef")).toThrow("验证码必须是 6 位数字");
  });

  it("binds the stored HMAC to the user and purpose", () => {
    const input = {
      code: "012345",
      hashSecret: "test-auth-code-secret",
      purpose: "verify-email" as const,
      userId: "user-1",
    };
    const codeHash = hashAuthCode(input);

    expect(codeHash).toHaveLength(64);
    expect(codeHash).not.toContain(input.code);
    expect(hashAuthCode({ ...input, userId: "user-2" })).not.toBe(codeHash);
    expect(hashAuthCode({ ...input, purpose: "reset-password" })).not.toBe(codeHash);
    expect(() => hashAuthCode({ ...input, hashSecret: "" })).toThrow("AUTH_HASH_SECRET 未配置");
  });
});
