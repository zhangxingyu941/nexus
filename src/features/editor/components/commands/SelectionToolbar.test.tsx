import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SelectionToolbar } from "./SelectionToolbar";

describe("SelectionToolbar", () => {
  it("renders nothing when anchor is null", () => {
    const { container } = render(
      <SelectionToolbar
        anchor={null}
        canLink
        onBold={vi.fn()}
        onItalic={vi.fn()}
        onLink={vi.fn()}
        onStrike={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders formatting buttons and calls handlers", () => {
    const onBold = vi.fn();
    const onItalic = vi.fn();
    const onStrike = vi.fn();
    const onLink = vi.fn();
    const onComment = vi.fn();

    render(
      <SelectionToolbar
        anchor={{ left: 100, top: 50 }}
        canLink
        onBold={onBold}
        onComment={onComment}
        onItalic={onItalic}
        onLink={onLink}
        onStrike={onStrike}
      />,
    );

    expect(screen.getByRole("toolbar", { name: "文字工具" })).toBeVisible();

    fireEvent.click(screen.getByText("B"));
    fireEvent.click(screen.getByText("I"));
    fireEvent.click(screen.getByText("S"));
    fireEvent.click(screen.getByText("链接"));
    fireEvent.click(screen.getByText("评论"));

    expect(onBold).toHaveBeenCalledTimes(1);
    expect(onItalic).toHaveBeenCalledTimes(1);
    expect(onStrike).toHaveBeenCalledTimes(1);
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(onComment).toHaveBeenCalledTimes(1);
  });

  it("hides comment button when not provided", () => {
    render(
      <SelectionToolbar
        anchor={{ left: 100, top: 50 }}
        canLink
        onBold={vi.fn()}
        onItalic={vi.fn()}
        onLink={vi.fn()}
        onStrike={vi.fn()}
      />,
    );

    expect(screen.queryByText("评论")).not.toBeInTheDocument();
  });
});
