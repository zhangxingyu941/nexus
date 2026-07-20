import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceTrashView } from "./WorkspaceTrashView";

const deleted = {
  deletedAt: Date.UTC(2026, 6, 16, 9, 30),
  deletedBy: { displayName: "林夏", id: "owner-1" },
  id: "workspace-1",
  name: "产品研发中心",
  purgeAfter: Date.UTC(2026, 6, 23, 9, 30),
};

describe("WorkspaceTrashView", () => {
  it("lists deletion metadata and restores the selected workspace", async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 6, 17, 9, 30));
    render(<WorkspaceTrashView onRestore={onRestore} workspaces={[deleted]} />);

    const item = screen.getByTestId("trashed-workspace-workspace-1");
    expect(within(item).getByText("林夏 删除")).toBeInTheDocument();
    expect(within(item).getByText("剩余 6 天")).toBeInTheDocument();
    const restore = within(item).getByRole("button", { name: "恢复并进入" });
    expect(restore).toHaveClass("w-full");

    await user.click(restore);
    expect(onRestore).toHaveBeenCalledWith(deleted.id);
  });

  it("shows an empty state when no workspaces are recoverable", () => {
    render(<WorkspaceTrashView onRestore={vi.fn()} workspaces={[]} />);
    expect(screen.getByText("回收站为空")).toBeInTheDocument();
  });
});
