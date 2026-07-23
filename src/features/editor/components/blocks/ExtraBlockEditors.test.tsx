import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListBlockEditor } from "./ExtraBlockEditors";

describe("ListBlockEditor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("edits one list block with a wrapping textarea and no secondary action buttons", () => {
    const onChange = vi.fn();

    render(
      <ListBlockEditor
        content="A long list item that must remain in this block"
        isReadOnly={false}
        onChange={onChange}
        onEnter={vi.fn()}
        type="bulletedList"
      />,
    );

    const editor = screen.getByRole("textbox", { name: /列表项/ });
    expect(editor.tagName).toBe("TEXTAREA");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();

    fireEvent.change(editor, { target: { value: "A wrapped list item" } });
    expect(onChange).toHaveBeenCalledWith("A wrapped list item");
  });

  it("creates the next list block from an unmodified Enter key", () => {
    const onEnter = vi.fn();

    render(
      <ListBlockEditor
        content="Item"
        isReadOnly={false}
        onChange={vi.fn()}
        onEnter={onEnter}
        type="numberedList"
      />,
    );

    const editor = screen.getByRole("textbox", { name: /列表项/ });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(onEnter).toHaveBeenCalledWith("numberedList");

    fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("recalculates its height when the available width changes", () => {
    const observe = vi.fn();
    let onResize: ResizeObserverCallback | undefined;
    let scrollHeight = 24;

    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        onResize = callback;
      }

      disconnect() {}
      observe = observe;
      unobserve() {}
    }

    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });

    render(
      <ListBlockEditor
        content="A long list item"
        isReadOnly={false}
        onChange={vi.fn()}
        onEnter={vi.fn()}
        type="bulletedList"
      />,
    );

    const editor = screen.getByRole("textbox", { name: /列表项/ });
    expect(editor).toHaveStyle({ height: "24px" });
    expect(observe).toHaveBeenCalledWith(editor);

    scrollHeight = 48;
    onResize?.([], {} as ResizeObserver);

    expect(editor).toHaveStyle({ height: "48px" });
  });
});
