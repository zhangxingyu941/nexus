import { describe, expect, it } from "vitest";
import { Argon2PasswordHasher } from "./passwordHasher";

describe("Argon2PasswordHasher", () => {
  it("hashes passwords with Argon2id and verifies the matching value", async () => {
    const hasher = new Argon2PasswordHasher();
    const hash = await hasher.hash("correct horse battery staple");

    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(hasher.verify(hash, "correct horse battery staple")).resolves.toBe(true);
    await expect(hasher.verify(hash, "incorrect password")).resolves.toBe(false);
  });

  it("treats malformed hashes as failed verification", async () => {
    const hasher = new Argon2PasswordHasher();

    await expect(hasher.verify("not-an-argon2-hash", "password")).resolves.toBe(false);
  });
});
