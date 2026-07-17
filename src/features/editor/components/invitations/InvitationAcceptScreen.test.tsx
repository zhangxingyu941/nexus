import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvitationAcceptScreen } from "./InvitationAcceptScreen";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
}));

const invite = {
  expiresAt: Date.now() + 60 * 60 * 1000,
  id: "invite-1",
  invitedBy: { displayName: "林夏", id: "user-1" },
  maskedEmail: "m***@example.com",
  role: "editor" as const,
  workspaceId: "workspace-1",
  workspaceName: "产品研发中心",
};

describe("InvitationAcceptScreen", () => {
  beforeEach(() => {
    navigation.push.mockReset();
    window.history.replaceState(null, "", "/");
    window.sessionStorage.clear();
  });

  it("exchanges the fragment once and removes it from the address bar", async () => {
    const fetchSpy = installFetch({ authenticated: true });
    window.history.replaceState(null, "", "/invitations/accept#token=raw-token");

    render(<InvitationAcceptScreen />);

    expect(window.location.hash).toBe("");
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      "/api/workspace-invites/resolve",
      expect.objectContaining({
        body: JSON.stringify({ token: "raw-token" }),
        method: "POST",
      }),
    ));
    expect(fetchSpy.mock.calls.filter(([url]) => url === "/api/workspace-invites/resolve"))
      .toHaveLength(1);
  });

  it("reuses authentication and encodes the invitation return path", async () => {
    installFetch({ authenticated: false, github: true });
    window.history.replaceState(null, "", "/invitations/accept#token=raw-token");

    render(<InvitationAcceptScreen />);

    expect(await screen.findByRole("heading", { name: "Nexus 工作区" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "使用 GitHub 登录" })).toHaveAttribute(
      "href",
      "/api/auth/oauth/github?returnTo=%2Finvitations%2Faccept",
    );
  });

  it("accepts the invitation and navigates into the selected workspace", async () => {
    const user = userEvent.setup();
    const fetchSpy = installFetch({ authenticated: true });
    window.history.replaceState(null, "", "/invitations/accept#token=raw-token");

    render(<InvitationAcceptScreen />);

    expect(await screen.findByRole("heading", { name: "产品研发中心" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "接受并进入" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      "/api/workspace-invites/accept",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(navigation.push).toHaveBeenCalledWith("/");
  });

  it("declines the invitation and shows a terminal state", async () => {
    const user = userEvent.setup();
    installFetch({ authenticated: true });
    window.history.replaceState(null, "", "/invitations/accept#token=raw-token");

    render(<InvitationAcceptScreen />);

    await user.click(await screen.findByRole("button", { name: "拒绝邀请" }));

    expect(await screen.findByRole("heading", { name: "已拒绝邀请" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "接受并进入" })).not.toBeInTheDocument();
  });

  it("renders expired invitations as a terminal state", async () => {
    const user = userEvent.setup();
    installFetch({ authenticated: true, transitionError: "invite_expired" });
    window.history.replaceState(null, "", "/invitations/accept#token=raw-token");

    render(<InvitationAcceptScreen />);

    await user.click(await screen.findByRole("button", { name: "接受并进入" }));

    expect(await screen.findByRole("heading", { name: "邀请已过期" })).toBeInTheDocument();
  });
});

function installFetch({
  authenticated,
  github = false,
  transitionError,
}: {
  authenticated: boolean;
  github?: boolean;
  transitionError?: string;
}) {
  const fetchSpy = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === "/api/workspace-invites/resolve") {
      return jsonResponse({ invite });
    }
    if (url === "/api/auth/session") {
      return authenticated
        ? jsonResponse({ mode: "database", user: { displayName: "成员", email: "member@example.com", id: "user-2" } })
        : jsonResponse({ code: "authentication_required", error: "请先登录" }, 401);
    }
    if (url === "/api/auth/oauth/config") {
      return jsonResponse({ github });
    }
    if (url === "/api/workspace-invites/accept") {
      return transitionError
        ? jsonResponse({ code: transitionError, error: "Invitation expired" }, 410)
        : jsonResponse({ catalog: { currentWorkspaceId: "workspace-1", workspaces: [] }, workspace: {} });
    }
    if (url === "/api/workspace-invites/decline") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
