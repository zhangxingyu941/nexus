import {
  hash as hashArgon2,
  verify as verifyArgon2,
} from "@node-rs/argon2";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(encodedHash: string, password: string): Promise<boolean>;
}

export class Argon2PasswordHasher implements PasswordHasher {
  async hash(password: string) {
    return hashArgon2(password, {
      algorithm: 2,
      memoryCost: 19_456,
      outputLen: 32,
      parallelism: 1,
      timeCost: 2,
      version: 1,
    });
  }

  async verify(encodedHash: string, password: string) {
    try {
      return await verifyArgon2(encodedHash, password);
    } catch {
      return false;
    }
  }
}
