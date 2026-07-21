// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCUMENT_SHARE_TTL_MS,
  resolveDocumentShareExpiresAt,
} from "../shared/documentShare";
import { DocumentShareTokenService } from "./documentShareTokens";

const TEST_SECRET = "test-document-share-secret-at-least-32-bytes";

describe("document share expiration", () => {
  it("defaults to 24 hours", () => {
    expect(resolveDocumentShareExpiresAt(undefined, 1_000))
      .toBe(1_000 + DEFAULT_DOCUMENT_SHARE_TTL_MS);
  });

  it("accepts a future timestamp up to 365 days", () => {
    const now = 1_000;
    const expiresAt = now + 365 * 24 * 60 * 60_000;

    expect(resolveDocumentShareExpiresAt(expiresAt, now)).toBe(expiresAt);
  });

  it("rejects invalid timestamps", () => {
    const now = 1_000;

    expect(() => resolveDocumentShareExpiresAt(now, now))
      .toThrow("分享过期时间必须晚于当前时间");
    expect(() => resolveDocumentShareExpiresAt(now + 366 * 24 * 60 * 60_000, now))
      .toThrow("分享有效期不能超过 365 天");
    expect(() => resolveDocumentShareExpiresAt(1.5, now))
      .toThrow("分享过期时间必须晚于当前时间");
  });
});

describe("DocumentShareTokenService", () => {
  it("creates a 256-bit token and hashes it in a secret-specific namespace", () => {
    const service = new DocumentShareTokenService(TEST_SECRET, () => 1_000);
    const token = service.createRawToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(service.hashRawToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(service.hashRawToken(token)).not.toBe(
      new DocumentShareTokenService(`${TEST_SECRET}x`, () => 1_000).hashRawToken(token),
    );
  });

  it("signs one attachment for at most five minutes", () => {
    const service = new DocumentShareTokenService(TEST_SECRET, () => 1_000);

    expect(service.signAttachment("share-1", "workspace-1/object.pdf", 601_000))
      .toMatchObject({ expiresAt: 301_000 });
    expect(service.signAttachment("share-1", "workspace-1/object.pdf", 101_000))
      .toMatchObject({ expiresAt: 101_000 });
  });

  it("verifies attachment signatures and rejects tampering or expiry", () => {
    let now = 1_000;
    const service = new DocumentShareTokenService(TEST_SECRET, () => now);
    const signed = service.signAttachment("share-1", "workspace-1/object.pdf", 601_000);

    expect(service.verifyAttachment({
      ...signed,
      objectKey: "workspace-1/object.pdf",
      shareId: "share-1",
    })).toBe(true);
    expect(service.verifyAttachment({
      ...signed,
      objectKey: "workspace-1/other.pdf",
      shareId: "share-1",
    })).toBe(false);

    now = signed.expiresAt;
    expect(service.verifyAttachment({
      ...signed,
      objectKey: "workspace-1/object.pdf",
      shareId: "share-1",
    })).toBe(false);
  });

  it.each(["", " ".repeat(32), "x".repeat(31)])(
    "rejects a blank or short secret",
    (secret) => {
      expect(() => new DocumentShareTokenService(secret)).toThrow();
    },
  );
});
