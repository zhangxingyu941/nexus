import { NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORKSPACE_INVITE_CONTEXT_COOKIE,
  clearWorkspaceInviteContextCookie,
  setWorkspaceInviteContextCookie,
} from "./inviteContextCookie";

describe("workspace invite context cookie", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets a scoped HttpOnly context cookie using the auth secure convention", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_COOKIE_SECURE", "false");
    const response = NextResponse.json({ ok: true });

    setWorkspaceInviteContextCookie(response, "signed-context", 61_000);

    expect(WORKSPACE_INVITE_CONTEXT_COOKIE).toBe("nexus_workspace_invite_context");
    expect(response.headers.get("set-cookie")).toContain(
      "nexus_workspace_invite_context=signed-context",
    );
    expect(response.headers.get("set-cookie")).toContain("Path=/api/workspace-invites");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("clears the scoped cookie with an immediate expiration", () => {
    const response = NextResponse.json({ ok: true });

    clearWorkspaceInviteContextCookie(response);

    expect(response.headers.get("set-cookie")).toContain("nexus_workspace_invite_context=");
    expect(response.headers.get("set-cookie")).toContain("Path=/api/workspace-invites");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("set-cookie")).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });
});
