import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MentionPopover } from "./MentionPopover";
import type { MentionItem } from "./useMentionSearch";

const items: MentionItem[] = [
  { id: "user-1", kind: "person", label: "Alice", subtext: "alice@example.com" },
  { id: "doc-1", kind: "document", label: "设计文档" },
  { id: "task-1", kind: "task", label: "实现登录" },
  { id: "today", kind: "date", label: "今天" },
];

describe("MentionPopover", () => {
  it("renders a listbox with aria-label 提及", () => {
    render(
      <MentionPopover
        activeIndex={0}
        anchor={{ bottom: 140, left: 80, top: 120 }}
        items={items}
        onSelect={vi.fn()}
        query=""
      />,
    );

    expect(screen.getByRole("listbox", { name: "提及" })).toBeVisible();
  });

  it("groups results by kind with section labels", () => {
    render(
      <MentionPopover
        activeIndex={0}
        anchor={{ bottom: 140, left: 80, top: 120 }}
        items={items}
        onSelect={vi.fn()}
        query=""
      />,
    );

    expect(screen.getByText("人员")).toBeVisible();
    expect(screen.getByText("文档")).toBeVisible();
    expect(screen.getByRole("option", { name: /Alice/ })).toBeVisible();
    expect(screen.getByRole("option", { name: /设计文档/ })).toBeVisible();
  });

  it("shows empty message when results are empty", () => {
    render(
      <MentionPopover
        activeIndex={-1}
        anchor={{ bottom: 140, left: 80, top: 120 }}
        items={[]}
        onSelect={vi.fn()}
        query="zzz"
      />,
    );

    expect(screen.getByText("无匹配结果")).toBeVisible();
  });

  it("calls onSelect when an option is clicked", () => {
    const onSelect = vi.fn();
    render(
      <MentionPopover
        activeIndex={0}
        anchor={{ bottom: 140, left: 80, top: 120 }}
        items={items}
        onSelect={onSelect}
        query=""
      />,
    );

    fireEvent.click(screen.getByRole("option", { name: /Alice/ }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "user-1", label: "Alice" }),
    );
  });

  it("does not call onSelect twice on pointerdown + click", () => {
    const onSelect = vi.fn();
    render(
      <MentionPopover
        activeIndex={0}
        anchor={{ bottom: 140, left: 80, top: 120 }}
        items={items}
        onSelect={onSelect}
        query=""
      />,
    );

    const option = screen.getByRole("option", { name: /Alice/ });

    expect(fireEvent.pointerDown(option)).toBe(false);
    fireEvent.click(option);

    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
