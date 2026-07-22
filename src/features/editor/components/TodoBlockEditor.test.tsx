import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createRichTextFromPlainText } from "@/shared/richText";
import { TodoBlockEditor } from "./TodoBlockEditor";

function renderTodo(collaborationDocument: Y.Doc | null = null) {
  return render(
    <TodoBlockEditor
      blockId="todo-1"
      checked={false}
      collaborationDocument={collaborationDocument}
      content="Ship the editor"
      richText={createRichTextFromPlainText("Ship the editor")}
      focusRequest={false}
      isReadOnly={false}
      onChange={vi.fn()}
      onEnter={vi.fn()}
      onFocused={vi.fn()}
      onMarkdownShortcut={vi.fn()}
      onOpenCommandMenu={vi.fn()}
      onToggle={vi.fn()}
    />,
  );
}

describe("TodoBlockEditor", () => {
  it("uses a direct contenteditable surface instead of a text input", async () => {
    const { container } = renderTodo();

    expect(screen.getByRole("checkbox", { name: "待办完成状态" })).toBeVisible();
    expect(container.querySelector('input[aria-label="待办内容"]')).toBeNull();
    expect(await screen.findByLabelText("待办内容")).toHaveAttribute("contenteditable", "true");
  });

  it("binds todo text to the block collaboration fragment", async () => {
    const ydoc = new Y.Doc();
    renderTodo(ydoc);

    await waitFor(() =>
      expect(ydoc.getXmlFragment("block-content:todo-1").length).toBeGreaterThan(0),
    );
    expect(screen.getByLabelText("待办内容")).toHaveTextContent("Ship the editor");
  });
});
