import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReceivedWorkspaceInvite } from "@/shared/workspaceInvites";
import { WorkspaceInvitationCenter } from "./WorkspaceInvitationCenter";

const invites: ReceivedWorkspaceInvite[] = [
  {
    expiresAt: Date.UTC(2026, 6, 18),
    id: "invite-1",
    invitedBy: { displayName: "林夏", id: "owner-1" },
    maskedEmail: "m***@example.com",
    role: "editor",
    workspaceId: "workspace-1",
    workspaceName: "产品协作",
  },
  {
    expiresAt: Date.UTC(2026, 6, 19),
    id: "invite-2",
    invitedBy: { displayName: "周屿", id: "owner-2" },
    maskedEmail: "m***@example.com",
    role: "viewer",
    workspaceId: "workspace-2",
    workspaceName: "设计评审",
  },
];

describe("WorkspaceInvitationCenter", () => {
  it("shows the pending count and locks only the selected item", async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn(() => new Promise<void>(() => undefined));

    render(
      <WorkspaceInvitationCenter
        invites={invites}
        onAccept={onAccept}
        onDecline={vi.fn()}
        onOpenChange={vi.fn()}
        open
      />,
    );

    expect(screen.getByText("2 个待处理")).toBeInTheDocument();
    const acceptButtons = screen.getAllByRole("button", { name: "接受并进入" });
    await user.click(acceptButtons[0]);

    expect(onAccept).toHaveBeenCalledWith("invite-1");
    expect(acceptButtons[0]).toBeDisabled();
    expect(acceptButtons[1]).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "拒绝" })[1]).toBeEnabled();
  });

  it("requires explicit confirmation before declining an invitation", async () => {
    const user = userEvent.setup();
    const onDecline = vi.fn().mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    render(
      <WorkspaceInvitationCenter
        invites={invites}
        onAccept={vi.fn()}
        onDecline={onDecline}
        onOpenChange={vi.fn()}
        open
      />,
    );

    const declineButton = screen.getAllByRole("button", { name: "拒绝" })[0];
    await user.click(declineButton);
    expect(onDecline).not.toHaveBeenCalled();

    await user.click(declineButton);
    expect(confirm).toHaveBeenCalledWith("确定拒绝“产品协作”的工作区邀请吗？");
    expect(onDecline).toHaveBeenCalledWith("invite-1");
  });

  it("uses an accessible full-width sheet capped near 420px on larger screens", () => {
    render(
      <WorkspaceInvitationCenter
        invites={invites}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
        onOpenChange={vi.fn()}
        open
      />,
    );

    expect(screen.getByRole("dialog", { name: "工作区邀请" }))
      .toHaveClass("w-full", "sm:max-w-[420px]");
  });
});
