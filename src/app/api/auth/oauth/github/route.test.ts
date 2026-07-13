import { describe, expect, it, vi } from "vitest";
import { createGitHubStartRouteHandler } from "./handlers";

describe("GitHub OAuth start route", () => {
  it("redirects with short-lived HttpOnly state and PKCE cookies", async () => {
    const oauth = {
      createAuthorization: vi.fn(() => ({
        codeVerifier: "pkce-verifier",
        state: "oauth-state",
        url: "https://github.com/login/oauth/authorize?state=oauth-state",
      })),
    };
    const response = await createGitHubStartRouteHandler(oauth)(
      new Request("http://localhost/api/auth/oauth/github"),
    );
    const cookies = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://github.com/login/oauth/authorize?state=oauth-state");
    expect(cookies).toContain("notion_editor_oauth_state=oauth-state");
    expect(cookies).toContain("notion_editor_oauth_verifier=pkce-verifier");
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("SameSite=lax");
    expect(cookies).toContain("Max-Age=600");
  });
});
