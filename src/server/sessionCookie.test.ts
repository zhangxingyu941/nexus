import { afterEach, describe, expect, it, vi } from "vitest";
import { getSessionCookieOptions } from "./sessionCookie";

describe("getSessionCookieOptions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses secure cookies by default in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_COOKIE_SECURE", "");

    expect(getSessionCookieOptions(Date.now() + 60_000).secure).toBe(true);
  });

  it("allows an explicit insecure cookie for local HTTP acceptance", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_COOKIE_SECURE", "false");

    expect(getSessionCookieOptions(Date.now() + 60_000).secure).toBe(false);
  });

  it("allows secure cookies to be forced in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_COOKIE_SECURE", "true");

    expect(getSessionCookieOptions(Date.now() + 60_000).secure).toBe(true);
  });
});
