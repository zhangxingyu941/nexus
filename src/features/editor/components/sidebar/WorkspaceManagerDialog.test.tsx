import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceCatalog } from "../../../../shared/workspace";
import { WorkspaceManagerDialog } from "./WorkspaceManagerDialog";

const catalog: WorkspaceCatalog = {
  currentWorkspaceId: "workspace-a",
  workspaces: [
    { createdAt: 1000, id: "workspace-a", name: "Nexus 工作区", role: "owner", updatedAt: 1000 },
    { createdAt: 2000, id: "workspace-b", name: "研发中心", role: "editor", updatedAt: 2000 },
  ],
};

describe("WorkspaceManagerDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("searches workspaces and exposes role-appropriate actions", async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkspaceManagerDialog
        catalog={catalog}
        error=""
        isTransitioning={false}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onSwitch={onSwitch}
        open
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "工作区管理" });
    const ownerRow = within(dialog).getByTestId("workspace-row-workspace-a");
    const editorRow = within(dialog).getByTestId("workspace-row-workspace-b");
    expect(within(ownerRow).getByRole("button", { name: "重命名 Nexus 工作区" })).toBeEnabled();
    expect(within(editorRow).queryByRole("button", { name: /重命名/ })).toBeNull();
    await user.click(within(editorRow).getByRole("button", { name: "切换到研发中心" }));
    expect(onSwitch).toHaveBeenCalledWith("workspace-b");

    await user.type(screen.getByRole("searchbox", { name: "搜索工作区" }), "研发");
    expect(screen.getByText("研发中心")).toBeInTheDocument();
    expect(screen.queryByText("Nexus 工作区")).not.toBeInTheDocument();
  });

  it("uses one dialog for create and rename forms", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(
      <WorkspaceManagerDialog
        catalog={catalog}
        error=""
        isTransitioning={false}
        onClose={vi.fn()}
        onCreate={onCreate}
        onRename={onRename}
        onSwitch={vi.fn()}
        open
      />,
    );

    await user.click(screen.getByRole("button", { name: "新建工作区" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await user.type(screen.getByLabelText("工作区名称"), "产品团队");
    await user.click(screen.getByRole("button", { name: "创建并切换" }));
    expect(onCreate).toHaveBeenCalledWith("产品团队");

    await user.click(screen.getByRole("button", { name: "重命名 Nexus 工作区" }));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const input = screen.getByLabelText("工作区名称");
    await user.clear(input);
    await user.type(input, "核心团队");
    await user.click(screen.getByRole("button", { name: "保存名称" }));
    expect(onRename).toHaveBeenCalledWith("workspace-a", "核心团队");
  });

  it("opens owner management details without exposing management to editors", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      members: [
        { displayName: "林夏", email: "owner@example.com", id: "owner-1", joinedAt: 1000, role: "owner" },
      ],
    }), { headers: { "Content-Type": "application/json" }, status: 200 }));
    render(
      <WorkspaceManagerDialog
        catalog={catalog}
        error=""
        isTransitioning={false}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onSwitch={vi.fn()}
        open
      />,
    );

    const ownerRow = screen.getByTestId("workspace-row-workspace-a");
    const editorRow = screen.getByTestId("workspace-row-workspace-b");
    expect(within(editorRow).queryByRole("button", { name: "管理 研发中心" })).toBeNull();
    await user.click(within(ownerRow).getByRole("button", { name: "管理 Nexus 工作区" }));

    expect(screen.getByRole("heading", { name: "Nexus 工作区" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回工作区列表" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "成员" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "邀请" })).toBeInTheDocument();
    expect(await screen.findByText("owner@example.com")).toBeInTheDocument();
  });
});
