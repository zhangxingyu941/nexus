import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceMembersTab } from "./WorkspaceMembersTab";

const membersWithTwoOwners = [
  { displayName: "林夏", email: "owner@example.com", id: "owner-1", joinedAt: 1000, role: "owner" as const },
  { displayName: "王芳", email: "owner2@example.com", id: "owner-2", joinedAt: 500, role: "owner" as const },
  { displayName: "周宁", email: "editor@example.com", id: "editor-1", joinedAt: 2000, role: "editor" as const },
];

function mockFetch(response: unknown, status = 200) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(response), { status }),
  );
}

describe("WorkspaceMembersTab", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("protects the final owner and defaults transfer retention on", async () => {
    mockFetch({ members: membersWithTwoOwners });
    render(
      <WorkspaceMembersTab
        currentUserId="owner-1"
        session={{ runServerTransition: vi.fn() }}
        workspaceId="workspace-1"
      />,
    );

    await screen.findByText("owner@example.com");

    expect(screen.getByRole("button", { name: "退出工作区" })).toBeEnabled();

    const transferButton = screen.getByRole("button", { name: /转让所有权/ });
    await userEvent.click(transferButton);

    const dialog = screen.getByRole("dialog", { name: "转让所有权" });
    expect(dialog.querySelector("[type=checkbox]")).toBeChecked();
  });

  it("shows role selector for owners and action menu for non-self members", async () => {
    mockFetch({ members: membersWithTwoOwners });
    render(
      <WorkspaceMembersTab
        currentUserId="owner-1"
        session={{ runServerTransition: vi.fn() }}
        workspaceId="workspace-1"
      />,
    );

    await screen.findByText("owner@example.com");

    expect(screen.getByText("编辑者", { selector: "[data-slot=select-value]" })).toBeInTheDocument();
    expect(screen.getByText("(你)")).toBeInTheDocument();
  });

  it("does not show owner-specific controls for non-owner users", async () => {
    mockFetch({ members: membersWithTwoOwners });
    render(
      <WorkspaceMembersTab
        currentUserId="editor-1"
        workspaceId="workspace-1"
      />,
    );

    await screen.findByText("editor@example.com");

    expect(screen.queryByRole("button", { name: /转让所有权/ })).not.toBeInTheDocument();
  });

  it("returns the leave transition through the workspace session", async () => {
    const transition = {
      catalog: { currentWorkspaceId: "fallback-1", workspaces: [] },
      workspace: { content: {}, summary: { id: "fallback-1" } },
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ members: membersWithTwoOwners }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(transition), { status: 200 }));
    const runServerTransition = vi.fn(async (operation: () => Promise<unknown>) => operation());
    render(
      <WorkspaceMembersTab
        currentUserId="editor-1"
        session={{ runServerTransition }}
        workspaceId="workspace-1"
      />,
    );

    await screen.findByText("editor@example.com");
    await userEvent.click(screen.getByRole("button"));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "确认退出" }));

    await waitFor(() => expect(runServerTransition).toHaveBeenCalledTimes(1));
    await expect(runServerTransition.mock.results[0]!.value).resolves.toEqual(transition);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "/api/workspaces/workspace-1/leave",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("renders loading state", () => {
    mockFetch(new Promise(() => {}));
    render(
      <WorkspaceMembersTab workspaceId="workspace-1" />
    );

    expect(screen.getByText("正在加载成员...")).toBeInTheDocument();
  });
});
