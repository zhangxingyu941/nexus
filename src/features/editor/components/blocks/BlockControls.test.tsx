import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BlockControls } from "./BlockControls";

function renderControls({
  isSelected = false,
  isSelectionActive = false,
  onSelect = vi.fn(),
}: {
  isSelected?: boolean;
  isSelectionActive?: boolean;
  onSelect?: (mode: "range" | "replace" | "toggle") => void;
} = {}) {
  return render(
    <TooltipProvider>
      <BlockControls
        blockId="block-1"
        canIndent={false}
        canOutdent={false}
        isFirst
        isLast
        isMenuOpen={false}
        isSelected={isSelected}
        isSelectionActive={isSelectionActive}
        onAddAfter={vi.fn()}
        onChangeType={vi.fn()}
        onDelete={vi.fn()}
        onIndent={vi.fn()}
        onMenuOpenChange={vi.fn()}
        onMove={vi.fn()}
        onOutdent={vi.fn()}
        onSelect={onSelect}
      />
    </TooltipProvider>,
  );
}

function touchPointerEvent(type: "pointerdown" | "pointerup") {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "pointerType", { value: "touch" });
  return event;
}

describe("BlockControls touch selection", () => {
  afterEach(() => vi.useRealTimers());

  it("selects after a touch long press and toggles later touch taps", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const rendered = renderControls({ onSelect });
    const button = screen.getByRole("button", { name: "选择块 block-1" });

    fireEvent(button, touchPointerEvent("pointerdown"));
    act(() => vi.advanceTimersByTime(180));

    expect(onSelect).toHaveBeenCalledWith("replace");
    fireEvent(button, touchPointerEvent("pointerup"));
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledTimes(1);

    rendered.rerender(
      <TooltipProvider>
        <BlockControls
          blockId="block-1"
          canIndent={false}
          canOutdent={false}
          isFirst
          isLast
          isMenuOpen={false}
          isSelectionActive
          onAddAfter={vi.fn()}
          onChangeType={vi.fn()}
          onDelete={vi.fn()}
          onIndent={vi.fn()}
          onMenuOpenChange={vi.fn()}
          onMove={vi.fn()}
          onOutdent={vi.fn()}
          onSelect={onSelect}
        />
      </TooltipProvider>,
    );

    fireEvent(button, touchPointerEvent("pointerdown"));
    fireEvent(button, touchPointerEvent("pointerup"));
    fireEvent.click(button);

    expect(onSelect).toHaveBeenLastCalledWith("toggle");
  });
});
