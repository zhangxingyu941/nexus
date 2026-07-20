import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultWorkspace } from "../model/workspaceOperations";
import { WorkspaceShell } from "./WorkspaceShell";

const sessionMock = vi.hoisted(() => ({
  useWorkspaceSession: vi.fn(),
}));
const inviteRepositoryMock = vi.hoisted(() => ({
  acceptReceived: vi.fn(),
  declineReceived: vi.fn(),
  listReceived: vi.fn(),
}));

vi.mock("../session/useWorkspaceSession", () => sessionMock);
vi.mock("../persistence/workspaceInviteRepository", () => ({
  workspaceInviteRepository: inviteRepositoryMock,
}));
vi.mock("./EditorPage", () => ({
  EditorPage: ({ inviteCount, onManageWorkspaces, onOpenInvites, workspaceId }: {
    inviteCount: number;
    onManageWorkspaces: () => void;
    onOpenInvites?: () => void;
    workspaceId: string;
  }) => (
    <main>
      编辑器 {workspaceId}
      <button onClick={onManageWorkspaces} type="button">管理工作区</button>
      {onOpenInvites ? <button onClick={onOpenInvites} type="button">邀请 {inviteCount}</button> : null}
    </main>
  ),
}));
vi.mock("./invitations/WorkspaceInvitationCenter", () => ({
  WorkspaceInvitationCenter: ({ invites, onAccept, onDecline, open }: {
    invites: Array<{ id: string; workspaceName: string }>;
    onAccept: (inviteId: string) => Promise<void>;
    onDecline: (inviteId: string) => Promise<void>;
    open: boolean;
  }) => open ? (
    <aside aria-label="工作区邀请">
      {invites.map((invite) => (
        <div key={invite.id}>
          <span>{invite.workspaceName}</span>
          <button onClick={() => void onAccept(invite.id)} type="button">接受 {invite.id}</button>
          <button onClick={() => void onDecline(invite.id)} type="button">拒绝 {invite.id}</button>
        </div>
      ))}
    </aside>
  ) : null,
}));

describe("WorkspaceShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders loading and retry states without fallback editor content", () => {
    sessionMock.useWorkspaceSession.mockReturnValueOnce(controller({ isLoading: true }));
    const { rerender } = render(<WorkspaceShell mode="local" sessionUser={null} />);
    expect(screen.getByRole("status", { name: "正在加载工作区" })).toBeInTheDocument();

    sessionMock.useWorkspaceSession.mockReturnValueOnce(controller({ error: "加载失败", snapshot: null }));
    rerender(<WorkspaceShell mode="local" sessionUser={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("加载失败");
    expect(screen.getByRole("button", { name: "重新加载" })).toBeInTheDocument();
  });

  it("renders the selected workspace through the controlled editor", () => {
    sessionMock.useWorkspaceSession.mockReturnValue(controller());
    render(<WorkspaceShell mode="local" sessionUser={null} />);
    expect(screen.getByText("编辑器 workspace-a")).toBeInTheDocument();
    expect(inviteRepositoryMock.listReceived).not.toHaveBeenCalled();
  });

  it("loads received invites in database mode and accepts through a server transition", async () => {
    const user = userEvent.setup();
    const session = controller();
    const invite = receivedInvite();
    inviteRepositoryMock.listReceived
      .mockResolvedValueOnce([invite])
      .mockResolvedValueOnce([]);
    inviteRepositoryMock.acceptReceived.mockResolvedValue({ catalog: session.catalog, workspace: session.snapshot });
    session.runServerTransition.mockImplementation(async (operation: () => Promise<unknown>) => {
      await operation();
    });
    sessionMock.useWorkspaceSession.mockReturnValue(session);

    render(<WorkspaceShell mode="database" sessionUser={null} />);

    await user.click(await screen.findByRole("button", { name: "邀请 1" }));
    await user.click(screen.getByRole("button", { name: "接受 invite-1" }));

    await waitFor(() => expect(inviteRepositoryMock.acceptReceived).toHaveBeenCalledWith("invite-1"));
    expect(session.runServerTransition).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(inviteRepositoryMock.listReceived).toHaveBeenCalledTimes(2));
  });

  it("declines a received invite and refreshes the list", async () => {
    const user = userEvent.setup();
    const invite = receivedInvite();
    inviteRepositoryMock.listReceived
      .mockResolvedValueOnce([invite])
      .mockResolvedValueOnce([]);
    inviteRepositoryMock.declineReceived.mockResolvedValue(undefined);
    sessionMock.useWorkspaceSession.mockReturnValue(controller());

    render(<WorkspaceShell mode="database" sessionUser={null} />);

    await user.click(await screen.findByRole("button", { name: "邀请 1" }));
    await user.click(screen.getByRole("button", { name: "拒绝 invite-1" }));

    await waitFor(() => expect(inviteRepositoryMock.declineReceived).toHaveBeenCalledWith("invite-1"));
    await waitFor(() => expect(inviteRepositoryMock.listReceived).toHaveBeenCalledTimes(2));
  });

  it("enables the lifecycle controls only in database mode", async () => {
    const user = userEvent.setup();
    sessionMock.useWorkspaceSession.mockReturnValue(controller());
    inviteRepositoryMock.listReceived.mockResolvedValue([]);
    render(<WorkspaceShell mode="database" sessionUser={null} />);

    await user.click(screen.getByRole("button", { name: "管理工作区" }));
    expect(screen.getByRole("button", { name: "打开回收站" })).toBeInTheDocument();
  });
});

function controller(overrides: Record<string, unknown> = {}) {
  const summary = {
    createdAt: 1000,
    id: "workspace-a",
    name: "Nexus 工作区",
    role: "owner" as const,
    updatedAt: 1000,
  };
  return {
    catalog: { currentWorkspaceId: summary.id, workspaces: [summary] },
    snapshot: { content: createDefaultWorkspace(1000), summary },
    saveStatus: "local",
    error: "",
    isLoading: false,
    isTransitioning: false,
    updateContent: vi.fn(),
    flushSave: vi.fn(),
    runServerTransition: vi.fn(),
    switchWorkspace: vi.fn(),
    createWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  };
}

function receivedInvite() {
  return {
    expiresAt: Date.UTC(2026, 6, 18),
    id: "invite-1",
    invitedBy: { displayName: "林夏", id: "owner-1" },
    maskedEmail: "m***@example.com",
    role: "editor" as const,
    workspaceId: "workspace-1",
    workspaceName: "产品协作",
  };
}
