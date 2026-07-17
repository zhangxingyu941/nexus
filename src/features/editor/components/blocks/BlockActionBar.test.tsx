import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createBlock } from "../../model/documentOperations";
import { BlockActionBar } from "./BlockActionBar";

describe("BlockActionBar", () => {
  it("shows the short current type in a compact toolbar", () => {
    const block = { ...createBlock("heading", 1000), headingLevel: 4 as const };
    render(
      <TooltipProvider>
        <BlockActionBar
          block={block}
          collabContent={<div>Collaboration</div>}
          commentsContent={<div>Comments</div>}
          isCollabOpen={false}
          isCommentsOpen={false}
          isReadOnly={false}
          onCollabOpenChange={vi.fn()}
          onCommentsOpenChange={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("toolbar", { name: "当前块操作" })).toBeVisible();
    expect(screen.getByText("H4")).toBeVisible();
    expect(screen.getByRole("button", { name: "打开块协作属性" })).toBeVisible();
    expect(screen.getByRole("button", { name: "打开块评论" })).toBeVisible();
  });
});
