import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInviteSummary } from "../../../../../shared/workspaceInvites";
import { WorkspaceInvitesTab } from "./WorkspaceInvitesTab";

const inviteRepositoryMock = vi.hoisted(() => ({
  create: vi.fn(),
  listSent: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("../../../persistence/workspaceInviteRepository", () => ({
  workspaceInviteRepository: inviteRepositoryMock,
}));

const now = Date.now();

function invite(overrides: Partial<WorkspaceInviteSummary> = {}): WorkspaceInviteSummary {
  return {
    createdAt: now - 120_000,
    deliveryStatus: "sent",
    email: "member@example.com",
    expiresAt: now + 86_400_000,
    id: "invite-1",
    invitedBy: { displayName: "林夏", id: "owner-1" },
    lastSentAt: now - 120_000,
    role: "editor",
    status: "pending",
    updatedAt: now - 120_000,
    workspaceId: "workspace-1",
    ...overrides,
  };
}

describe("WorkspaceInvitesTab", () => {
  beforeAll(() => {
    HTMLElement.prototype.hasPointerCapture = () => false;
    HTMLElement.prototype.setPointerCapture = () => undefined;
    HTMLElement.prototype.releasePointerCapture = () => undefined;
    HTMLElement.prototype.scrollIntoView = () => undefined;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    inviteRepositoryMock.listSent.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires an explicit role before sending an invitation", async () => {
    const user = userEvent.setup();
    const created = invite({ id: "invite-created", updatedAt: now, lastSentAt: now });
    inviteRepositoryMock.create.mockResolvedValue({ deliveryWarning: null, invite: created });
    render(<WorkspaceInvitesTab workspaceId="workspace-1" />);

    await user.type(screen.getByLabelText("成员邮箱"), "member@example.com");
    expect(screen.getByRole("button", { name: "发送邀请" })).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: "邀请角色" }));
    await user.click(await screen.findByRole("option", { name: "编辑者" }));
    expect(screen.getByRole("button", { name: "发送邀请" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "发送邀请" }));

    expect(inviteRepositoryMock.create).toHaveBeenCalledWith(
      "workspace-1",
      "member@example.com",
      "editor",
    );
    expect(await screen.findByText("邀请已发送")).toBeInTheDocument();
  });

  it("shows the resend cooldown and exposes resend and revoke for pending invitations", async () => {
    const user = userEvent.setup();
    const pending = invite({
      deliveryStatus: "failed",
      lastSentAt: null,
      updatedAt: now - 30_000,
    });
    inviteRepositoryMock.listSent.mockResolvedValue([pending]);
    inviteRepositoryMock.resend.mockResolvedValue({
      deliveryWarning: null,
      invite: invite({ updatedAt: now, lastSentAt: now }),
    });
    inviteRepositoryMock.revoke.mockResolvedValue(undefined);
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(now);
    const { rerender } = render(<WorkspaceInvitesTab workspaceId="workspace-1" />);

    const row = await screen.findByTestId("workspace-invite-invite-1");
    expect(within(row).getByText("发送失败")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "30 秒后可重发" })).toBeDisabled();

    dateNow.mockReturnValue(now + 31_000);
    rerender(<WorkspaceInvitesTab workspaceId="workspace-1" />);
    const readyRow = screen.getByTestId("workspace-invite-invite-1");
    await user.click(within(readyRow).getByRole("button", { name: "重发" }));
    expect(inviteRepositoryMock.resend).toHaveBeenCalledWith("workspace-1", "invite-1");

    await user.click(within(screen.getByTestId("workspace-invite-invite-1")).getByRole("button", { name: "撤销" }));
    expect(inviteRepositoryMock.revoke).toHaveBeenCalledWith("workspace-1", "invite-1");
  });

  it("shows recent terminal history and can invite a terminal recipient again", async () => {
    const user = userEvent.setup();
    inviteRepositoryMock.listSent.mockResolvedValue([
      invite({ id: "invite-expired", status: "expired", email: "again@example.com" }),
      invite({ id: "invite-accepted", status: "accepted", email: "joined@example.com" }),
    ]);
    inviteRepositoryMock.create.mockResolvedValue({
      deliveryWarning: null,
      invite: invite({ id: "invite-again", email: "again@example.com", updatedAt: now }),
    });
    render(<WorkspaceInvitesTab workspaceId="workspace-1" />);

    expect(await screen.findByText("最近 30 天")).toBeInTheDocument();
    expect(screen.getByText("已接受")).toBeInTheDocument();
    const expiredRow = screen.getByTestId("workspace-invite-invite-expired");
    await user.click(within(expiredRow).getByRole("button", { name: "重新邀请" }));

    expect(inviteRepositoryMock.create).toHaveBeenCalledWith(
      "workspace-1",
      "again@example.com",
      "editor",
    );
  });
});
