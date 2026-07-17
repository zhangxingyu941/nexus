import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EDITOR_COMMANDS } from "../../commands/editorCommands";
import { EditorCommandPopover } from "./EditorCommandPopover";

describe("EditorCommandPopover", () => {
  it("groups short command labels with listbox semantics", () => {
    render(
      <EditorCommandPopover
        activeIndex={0}
        anchor={{ bottom: 140, left: 80, top: 120 }}
        commands={EDITOR_COMMANDS}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("listbox", { name: "插入内容" })).toBeVisible();
    expect(screen.getByRole("option", { name: /H6/ })).toBeVisible();
    expect(screen.getByText("Text & Headings")).toBeVisible();
    expect(screen.getByText("Media")).toBeVisible();
    expect(screen.getByText("Data & Advanced")).toBeVisible();
  });

  it("preserves the editor selection on pointer down and executes once on click", () => {
    const onSelect = vi.fn();
    render(
      <EditorCommandPopover
        activeIndex={0}
        anchor={{ bottom: 140, left: 80, top: 120 }}
        commands={EDITOR_COMMANDS}
        onSelect={onSelect}
      />,
    );
    const todoOption = screen.getByRole("option", { name: /Todo/ });

    expect(fireEvent.pointerDown(todoOption)).toBe(false);
    fireEvent.click(todoOption);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "todo" }));
  });
});
