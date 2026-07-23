import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BlockSelectionToolbar } from "./BlockSelectionToolbar";

describe("BlockSelectionToolbar", () => {
  it("announces the selected count and dispatches an icon action", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();

    render(
      <TooltipProvider>
        <BlockSelectionToolbar
          anchor={{ left: 320, top: 140 }}
          isReadOnly={false}
          onAction={onAction}
          selectedCount={3}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("已选择 3 个块");
    await user.click(screen.getByRole("button", { name: "删除所选块" }));
    expect(onAction).toHaveBeenCalledWith("delete");
  });

  it("exposes a cut command for writable selections", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();

    render(
      <TooltipProvider>
        <BlockSelectionToolbar
          anchor={{ left: 320, top: 140 }}
          isReadOnly={false}
          onAction={onAction}
          selectedCount={1}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "剪切所选块" }));
    expect(onAction).toHaveBeenCalledWith("cut");
  });

  it("converts writable selections through the type menu", async () => {
    const user = userEvent.setup();
    const onChangeType = vi.fn();

    render(
      <TooltipProvider>
        <BlockSelectionToolbar
          anchor={{ left: 320, top: 140 }}
          isReadOnly={false}
          onAction={vi.fn()}
          onChangeType={onChangeType}
          selectedCount={2}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "转换所选块类型" }));
    await user.click(screen.getByRole("menuitem", { name: "转换为标题" }));

    expect(onChangeType).toHaveBeenCalledWith("heading");
  });

  it("only exposes copying when the document is read-only", () => {
    render(
      <TooltipProvider>
        <BlockSelectionToolbar
          anchor={{ left: 320, top: 140 }}
          isReadOnly
          onAction={vi.fn()}
          selectedCount={1}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("button", { name: "复制所选块" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "删除所选块" })).not.toBeInTheDocument();
  });
});
