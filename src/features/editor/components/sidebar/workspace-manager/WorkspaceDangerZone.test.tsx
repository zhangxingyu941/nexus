import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceDangerZone } from "./WorkspaceDangerZone";

const summary = {
  documentCount: 2,
  fileCount: 3,
  id: "workspace-1",
  memberCount: 4,
  name: "产品研发中心",
};

describe("WorkspaceDangerZone", () => {
  it("enables deletion only for the exact workspace name", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<WorkspaceDangerZone onDelete={onDelete} summary={summary} />);

    expect(screen.getByText("2 个文档")).toBeInTheDocument();
    expect(screen.getByText("4 名成员")).toBeInTheDocument();
    expect(screen.getByText("3 个文件")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "移至回收站" }));

    const confirmation = screen.getByRole("dialog", { name: "移至回收站" });
    const button = within(confirmation).getByRole("button", { name: "移至回收站" });
    expect(button).toBeDisabled();
    await user.type(
      screen.getByLabelText("输入完整工作区名称以确认"),
      `${summary.name} `,
    );
    expect(button).toBeDisabled();
    await user.clear(screen.getByLabelText("输入完整工作区名称以确认"));
    await user.type(screen.getByLabelText("输入完整工作区名称以确认"), summary.name);
    expect(button).toBeEnabled();

    await user.click(button);
    expect(onDelete).toHaveBeenCalledWith(summary.name);
    expect(confirmation).toBeInTheDocument();
  });
});
