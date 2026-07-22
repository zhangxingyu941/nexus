import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { RichTextBlockEditor } from "./RichTextBlockEditor";

describe("RichTextBlockEditor collaboration integration", () => {
  it("renders initial content when collaboration starts from an empty Yjs document", async () => {
    render(
      <RichTextBlockEditor
        blockId="block-1"
        collaborationDocument={new Y.Doc()}
        content="persisted content"
        focusRequest={false}
        onChange={vi.fn()}
        onEnter={vi.fn()}
        onFocused={vi.fn()}
        onMarkdownShortcut={vi.fn()}
        onOpenCommandMenu={vi.fn()}
        variant="paragraph"
      />,
    );

    await waitFor(() => expect(screen.getByTestId("block-editor-block-1")).toHaveTextContent("persisted content"));
  });

  it("reports text updates while TipTap collaboration is enabled", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <RichTextBlockEditor
        blockId="block-1"
        collaborationDocument={new Y.Doc()}
        content=""
        focusRequest={false}
        onChange={onChange}
        onEnter={vi.fn()}
        onFocused={vi.fn()}
        onMarkdownShortcut={vi.fn()}
        onOpenCommandMenu={vi.fn()}
        variant="paragraph"
      />,
    );

    const editor = screen.getByTestId("block-editor-block-1");

    await user.click(editor);
    await user.keyboard("collab content");

    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({
      content: "collab content",
      richText: {
        content: [{
          content: [{ text: "collab content", type: "text" }],
          type: "paragraph",
        }],
        type: "doc",
      },
    }));
  });

  it("keeps CRDT content when a delayed parent snapshot arrives during rapid input", async () => {
    const user = userEvent.setup();
    const ydoc = new Y.Doc();
    const props = {
      blockId: "block-1",
      collaborationDocument: ydoc,
      focusRequest: false,
      onChange: vi.fn(),
      onEnter: vi.fn(),
      onFocused: vi.fn(),
      onMarkdownShortcut: vi.fn(),
      onOpenCommandMenu: vi.fn(),
      variant: "paragraph" as const,
    };
    const { rerender } = render(<RichTextBlockEditor {...props} content="" />);
    const editor = screen.getByTestId("block-editor-block-1");

    await user.click(editor);
    await user.keyboard("fast collaborative input");
    await waitFor(() => expect(editor).toHaveTextContent("fast collaborative input"));

    rerender(<RichTextBlockEditor {...props} content="delayed parent snapshot" />);

    await waitFor(() => expect(editor).toHaveTextContent("fast collaborative input"));
  });
});
