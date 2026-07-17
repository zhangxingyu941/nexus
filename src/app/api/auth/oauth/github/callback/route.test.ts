import { describe, expect, it, vi } from "vitest";
import { createGitHubCallbackRouteHandler } from "./handlers";

describe("GitHub OAuth callback route", () => {
  it("validates the transaction, links the identity, and issues a session", async () => {
    const profile = {
      displayName: "林夏",
      email: "linxia@example.com",
      provider: "github" as const,
      providerAccountId: "42",
    };
    const oauth = { exchange: vi.fn().mockResolvedValue(profile) };
    const authStore = {
      loginWithOAuth: vi.fn().mockResolvedValue({
        expiresAt: 5000,
        token: "oauth-session-token",
        user: { displayName: "林夏", email: "linxia@example.com", id: "user-1" },
      }),
    };
    const security = createSecurity();
    const handler = createGitHubCallbackRouteHandler({ authStore, oauth, security });
    const response = await handler(new Request(
      "http://localhost/api/auth/oauth/github/callback?code=authorization-code&state=oauth-state",
      {
        headers: {
          Cookie: "notion_editor_oauth_state=oauth-state; notion_editor_oauth_verifier=pkce-verifier",
        },
      },
    ));
    const cookies = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(oauth.exchange).toHaveBeenCalledWith("authorization-code", "pkce-verifier");
    expect(authStore.loginWithOAuth).toHaveBeenCalledWith(profile);
    expect(cookies).toContain("notion_editor_session=oauth-session-token");
    expect(cookies).toContain("notion_editor_oauth_state=");
    expect(cookies).toContain("notion_editor_oauth_verifier=");
    expect(security.reset).toHaveBeenCalledWith(
      expect.any(Request),
      "github-callback",
      "oauth-state",
    );
  });

  it("rejects a mismatched state before exchanging the code", async () => {
    const oauth = { exchange: vi.fn() };
    const authStore = { loginWithOAuth: vi.fn() };
    const handler = createGitHubCallbackRouteHandler({ authStore, oauth, security: createSecurity() });
    const response = await handler(new Request(
      "http://localhost/api/auth/oauth/github/callback?code=authorization-code&state=attacker-state",
      {
        headers: {
          Cookie: "notion_editor_oauth_state=expected-state; notion_editor_oauth_verifier=pkce-verifier",
        },
      },
    ));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/?oauth=failed");
    expect(oauth.exchange).not.toHaveBeenCalled();
    expect(authStore.loginWithOAuth).not.toHaveBeenCalled();
  });

  it("redirects GitHub callback to a validated invitation path and clears it", async () => {
    const handler = createGitHubCallbackRouteHandler(createDependencies());
    const response = await handler(validCallbackRequest(
      "notion_editor_oauth_return_to=%2Finvitations%2Faccept",
    ));
    const cookies = response.headers.get("set-cookie") ?? "";

    expect(response.headers.get("location")).toBe("http://localhost/invitations/accept");
    expect(cookies).toContain("notion_editor_oauth_return_to=");
    expect(cookies).toContain("Max-Age=0");
  });

  it("defaults an invalid callback return cookie to the application root", async () => {
    const handler = createGitHubCallbackRouteHandler(createDependencies());
    const response = await handler(validCallbackRequest(
      "notion_editor_oauth_return_to=https%3A%2F%2Fattacker.example%2Fsteal",
    ));

    expect(response.headers.get("location")).toBe("http://localhost/");
  });
});

function createDependencies() {
  return {
    authStore: {
      loginWithOAuth: vi.fn().mockResolvedValue({
        expiresAt: 5000,
        token: "oauth-session-token",
        user: { displayName: "林夏", email: "linxia@example.com", id: "user-1" },
      }),
    },
    oauth: {
      exchange: vi.fn().mockResolvedValue({
        displayName: "林夏",
        email: "linxia@example.com",
        provider: "github" as const,
        providerAccountId: "42",
      }),
    },
    security: createSecurity(),
  };
}

function validCallbackRequest(extraCookie: string) {
  return new Request(
    "http://localhost/api/auth/oauth/github/callback?code=authorization-code&state=oauth-state",
    {
      headers: {
        Cookie: `notion_editor_oauth_state=oauth-state; notion_editor_oauth_verifier=pkce-verifier; ${extraCookie}`,
      },
    },
  );
}

function createSecurity() {
  return {
    audit: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 1, unavailable: false }),
    reset: vi.fn().mockResolvedValue(undefined),
  };
}
