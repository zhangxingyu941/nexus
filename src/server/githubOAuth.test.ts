import { describe, expect, it, vi } from "vitest";
import {
  GitHubOAuthService,
  getGitHubOAuthConfig,
} from "./githubOAuth";

describe("GitHub OAuth configuration", () => {
  it("is unavailable unless both credentials are configured", () => {
    expect(getGitHubOAuthConfig({ GITHUB_CLIENT_ID: "client" })).toBeNull();
    expect(getGitHubOAuthConfig({
      APP_URL: "http://localhost:3000/",
      GITHUB_CLIENT_ID: "client",
      GITHUB_CLIENT_SECRET: "secret",
    })).toEqual({
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "http://localhost:3000/api/auth/oauth/github/callback",
    });
  });
});

describe("GitHubOAuthService", () => {
  it("creates a state and PKCE authorization transaction", () => {
    const client = {
      createAuthorizationURL: vi.fn(() => new URL("https://github.com/login/oauth/authorize")),
      validateAuthorizationCode: vi.fn(),
    };
    const service = new GitHubOAuthService({
      client,
      codeVerifierFactory: () => "code-verifier",
      fetch: vi.fn(),
      stateFactory: () => "oauth-state",
    });

    expect(service.createAuthorization()).toEqual({
      codeVerifier: "code-verifier",
      state: "oauth-state",
      url: "https://github.com/login/oauth/authorize",
    });
    expect(client.createAuthorizationURL).toHaveBeenCalledWith(
      "oauth-state",
      "code-verifier",
      ["read:user", "user:email"],
    );
  });

  it("returns a normalized profile with a verified primary email", async () => {
    const client = {
      createAuthorizationURL: vi.fn(),
      validateAuthorizationCode: vi.fn().mockResolvedValue({ accessToken: () => "access-token" }),
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 42, login: "linxia", name: "林夏" }))
      .mockResolvedValueOnce(jsonResponse([
        { email: "other@example.com", primary: false, verified: true },
        { email: "LINXIA@Example.com", primary: true, verified: true },
      ]));
    const service = new GitHubOAuthService({
      client,
      codeVerifierFactory: () => "unused",
      fetch,
      stateFactory: () => "unused",
    });

    await expect(service.exchange("authorization-code", "code-verifier")).resolves.toEqual({
      displayName: "林夏",
      email: "linxia@example.com",
      provider: "github",
      providerAccountId: "42",
    });
    expect(client.validateAuthorizationCode).toHaveBeenCalledWith("authorization-code", "code-verifier");
  });

  it("rejects GitHub identities without a verified email", async () => {
    const service = new GitHubOAuthService({
      client: {
        createAuthorizationURL: vi.fn(),
        validateAuthorizationCode: vi.fn().mockResolvedValue({ accessToken: () => "access-token" }),
      },
      codeVerifierFactory: () => "unused",
      fetch: vi.fn()
        .mockResolvedValueOnce(jsonResponse({ id: 42, login: "linxia", name: null }))
        .mockResolvedValueOnce(jsonResponse([
          { email: "linxia@example.com", primary: true, verified: false },
        ])),
      stateFactory: () => "unused",
    });

    await expect(service.exchange("code", "verifier")).rejects.toThrow("GitHub 账号没有已验证邮箱");
  });
});

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}
