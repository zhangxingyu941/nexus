import { describe, expect, it } from "vitest";
import { getOAuthProviderConfiguration } from "./handlers";

describe("OAuth provider configuration", () => {
  it("exposes availability without exposing credentials", () => {
    expect(getOAuthProviderConfiguration({ GITHUB_CLIENT_ID: "client-only" })).toEqual({ github: false });
    const configured = getOAuthProviderConfiguration({
      GITHUB_CLIENT_ID: "client-id",
      GITHUB_CLIENT_SECRET: "client-secret",
    });

    expect(configured).toEqual({ github: true });
    expect(JSON.stringify(configured)).not.toContain("client-secret");
  });
});
