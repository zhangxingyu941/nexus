import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDefaultWorkspace } from "../model/workspaceOperations";
import { WorkspaceShell } from "./WorkspaceShell";

const sessionMock = vi.hoisted(() => ({
  useWorkspaceSession: vi.fn(),
}));

vi.mock("../session/useWorkspaceSession", () => sessionMock);
vi.mock("./EditorPage", () => ({
  EditorPage: ({ workspaceId }: { workspaceId: string }) => <main>编辑器 {workspaceId}</main>,
}));

describe("WorkspaceShell", () => {
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
    switchWorkspace: vi.fn(),
    createWorkspace: vi.fn(),
    renameWorkspace: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  };
}
