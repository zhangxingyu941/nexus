import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SelectionToolbar } from "./SelectionToolbar";

const inactiveMarks = {
  bold: false,
  code: false,
  italic: false,
  link: false,
  strike: false,
};

describe("SelectionToolbar", () => {
  it("renders nothing when the selection anchor is absent", () => {
    const { container } = render(
      <TooltipProvider>
        <SelectionToolbar
          activeMarks={inactiveMarks}
          anchor={null}
          onBold={vi.fn()}
          onCode={vi.fn()}
          onItalic={vi.fn()}
          onLink={vi.fn()}
          onStrike={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(container.firstChild).toBeNull();
  });

  it("exposes icon controls with active mark states and calls their handlers", () => {
    const onBold = vi.fn();
    const onItalic = vi.fn();
    const onStrike = vi.fn();
    const onCode = vi.fn();
    const onLink = vi.fn();
    const onComment = vi.fn();

    render(
      <TooltipProvider>
        <SelectionToolbar
          activeMarks={{ ...inactiveMarks, bold: true, italic: true }}
          anchor={{ left: 100, top: 50 }}
          onBold={onBold}
          onCode={onCode}
          onComment={onComment}
          onItalic={onItalic}
          onLink={onLink}
          onStrike={onStrike}
        />
      </TooltipProvider>,
    );

    const toolbar = screen.getByRole("toolbar", { name: "Text formatting" });
    expect(toolbar).toBeVisible();
    expect(screen.getByLabelText("Bold")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Italic")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Code")).toHaveAttribute("aria-pressed", "false");

    for (const label of ["Bold", "Italic", "Strikethrough", "Code", "Link", "Comment"]) {
      expect(screen.getByLabelText(label)).toHaveClass("selection-toolbar-button");
    }

    fireEvent.click(screen.getByLabelText("Bold"));
    fireEvent.click(screen.getByLabelText("Italic"));
    fireEvent.click(screen.getByLabelText("Strikethrough"));
    fireEvent.click(screen.getByLabelText("Code"));
    fireEvent.click(screen.getByLabelText("Link"));
    fireEvent.click(screen.getByLabelText("Comment"));

    expect(onBold).toHaveBeenCalledTimes(1);
    expect(onItalic).toHaveBeenCalledTimes(1);
    expect(onStrike).toHaveBeenCalledTimes(1);
    expect(onCode).toHaveBeenCalledTimes(1);
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(onComment).toHaveBeenCalledTimes(1);
  });

  it("clamps its centered anchor within the viewport", () => {
    render(
      <TooltipProvider>
        <SelectionToolbar
          activeMarks={inactiveMarks}
          anchor={{ left: 100, top: 50 }}
          onBold={vi.fn()}
          onCode={vi.fn()}
          onItalic={vi.fn()}
          onLink={vi.fn()}
          onStrike={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("toolbar", { name: "Text formatting" })).toHaveStyle({
      left: "clamp(136px, 100px, calc(100vw - 136px))",
    });
  });

  it("prevents pointer focus changes before applying a formatting action", () => {
    const onBold = vi.fn();
    render(
      <TooltipProvider>
        <SelectionToolbar
          activeMarks={inactiveMarks}
          anchor={{ left: 100, top: 50 }}
          onBold={onBold}
          onCode={vi.fn()}
          onItalic={vi.fn()}
          onLink={vi.fn()}
          onStrike={vi.fn()}
        />
      </TooltipProvider>,
    );

    const event = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    const button = screen.getByLabelText("Bold");
    button.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
