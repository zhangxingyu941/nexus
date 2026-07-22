import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createRichTextFromPlainText, type RichTextDocument } from "@/shared/richText";
import { RichTextBlockEditor } from "./RichTextBlockEditor";

type TiptapExtensionConfig = {
  name?: string;
  options: {
    document?: unknown;
    field?: string;
    history?: boolean;
  };
};

type TiptapEditorOptions = {
  content: unknown;
  editable: boolean;
  editorProps: {
    handleKeyDown: (view: {
      coordsAtPos: (position: number) => { bottom: number; left: number; top: number };
      dispatch: (transaction: unknown) => void;
      state: {
        doc: { content: { size: number }; textContent: string };
        selection: { from: number };
        tr: { delete: (from: number, to: number) => unknown };
      };
    }, event: KeyboardEvent) => boolean;
  };
  extensions: TiptapExtensionConfig[];
  onBlur: () => void;
  onSelectionUpdate: (payload: {
    editor: {
      state: { selection: { empty: boolean; from: number; to: number } };
      view: { coordsAtPos: (position: number) => { left: number; top: number } };
    };
  }) => void;
  onUpdate: (payload: {
    editor: {
      commands: {
        setContent: (content: string) => void;
      };
      getText: () => string;
      getJSON: () => unknown;
    };
  }) => void;
};

const tiptapMock = vi.hoisted(() => {
  const editor = {
    commands: {
      focus: vi.fn(),
      setContent: vi.fn(),
    },
    getText: vi.fn(() => ""),
    getJSON: vi.fn(() => ({ content: [{ type: "paragraph" }], type: "doc" })),
    isFocused: false,
  };
  const useEditor = vi.fn((_: TiptapEditorOptions, _deps?: unknown[]) => editor);

  return { editor, useEditor };
});

vi.mock("@tiptap/react", () => ({
  EditorContent: () => <div data-testid="editor-content" />,
  useEditor: tiptapMock.useEditor,
}));

describe("RichTextBlockEditor", () => {
  beforeEach(() => {
    tiptapMock.useEditor.mockClear();
    tiptapMock.editor.commands.setContent.mockClear();
    tiptapMock.editor.getText.mockReturnValue("");
    tiptapMock.editor.getJSON.mockReturnValue({ content: [{ type: "paragraph" }], type: "doc" });
    tiptapMock.editor.isFocused = false;
  });

  it("configures TipTap collaboration when a Yjs document is available", () => {
    const ydoc = new Y.Doc();

    render(
      <RichTextBlockEditor
        blockId="block-1"
        collaborationDocument={ydoc}
        content="Initial content"
        focusRequest={false}
        onChange={vi.fn()}
        onEnter={vi.fn()}
        onFocused={vi.fn()}
        onMarkdownShortcut={vi.fn()}
        onOpenCommandMenu={vi.fn()}
        variant="paragraph"
      />,
    );

    const editorOptions = tiptapMock.useEditor.mock.calls[0][0];
    const collaborationExtension = editorOptions.extensions.find(
      (extension: { name?: string }) => extension.name === "collaboration",
    );

    if (!collaborationExtension) {
      throw new Error("Expected collaboration extension to be configured.");
    }

    expect(collaborationExtension.options).toMatchObject({
      document: ydoc,
      field: "block-content:block-1",
    });
    expect(editorOptions.content).toEqual(createRichTextFromPlainText("Initial content"));
    expect(editorOptions.extensions[0].options.history).toBe(false);
    expect(tiptapMock.useEditor.mock.calls[0][1]).toEqual(["block-1", ydoc, false]);
  });

  it("registers the Link extension for the selection toolbar commands", () => {
    render(
      <RichTextBlockEditor
        blockId="block-1"
        collaborationDocument={null}
        content="Initial content"
        focusRequest={false}
        onChange={vi.fn()}
        onEnter={vi.fn()}
        onFocused={vi.fn()}
        onMarkdownShortcut={vi.fn()}
        onOpenCommandMenu={vi.fn()}
        variant="paragraph"
      />,
    );

    const editorOptions = tiptapMock.useEditor.mock.calls[0][0];

    expect(editorOptions.extensions.some((extension) => extension.name === "link")).toBe(true);
  });

  it("reports normalized editor JSON even when its text projection is unchanged", () => {
    const onChange = vi.fn();

    render(
      <RichTextBlockEditor
        blockId="block-1"
        collaborationDocument={null}
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

    const editorOptions = tiptapMock.useEditor.mock.calls[0][0];

    editorOptions.onUpdate({
      editor: {
        commands: {
          setContent: vi.fn(),
        },
        getText: () => "Updated content",
        getJSON: () => ({
          content: [{
            content: [{ marks: [{ type: "bold" }], text: "Updated content", type: "text" }],
            type: "paragraph",
          }],
          type: "doc",
        }),
      },
    });

    expect(onChange).toHaveBeenCalledWith({
      content: "Updated content",
      richText: {
        content: [{
          content: [{ marks: [{ type: "bold" }], text: "Updated content", type: "text" }],
          type: "paragraph",
        }],
        type: "doc",
      },
    });
  });

  it("initializes a text block from structured JSON", () => {
    const richText: RichTextDocument = {
      content: [{
        content: [{ marks: [{ type: "italic" }], text: "Formatted", type: "text" }],
        type: "paragraph",
      }],
      type: "doc",
    };

    render(
      <RichTextBlockEditor
        blockId="block-structured"
        collaborationDocument={null}
        content="Formatted"
        focusRequest={false}
        onChange={vi.fn()}
        onEnter={vi.fn()}
        onFocused={vi.fn()}
        onMarkdownShortcut={vi.fn()}
        onOpenCommandMenu={vi.fn()}
        richText={richText}
        variant="paragraph"
      />,
    );

    expect(tiptapMock.useEditor.mock.calls[0][0].content).toEqual(richText);
  });

  it("opens the command menu at the current caret coordinates", () => {
    const onOpenCommandMenu = vi.fn();
    render(
      <RichTextBlockEditor
        blockId="block-1"
        collaborationDocument={null}
        content=""
        focusRequest={false}
        onChange={vi.fn()}
        onEnter={vi.fn()}
        onFocused={vi.fn()}
        onMarkdownShortcut={vi.fn()}
        onOpenCommandMenu={onOpenCommandMenu}
        variant="paragraph"
      />,
    );
    const editorOptions = tiptapMock.useEditor.mock.calls[0][0];
    const view = {
      coordsAtPos: vi.fn(() => ({ bottom: 220, left: 140, top: 200 })),
      dispatch: vi.fn(),
      state: {
        doc: { content: { size: 0 }, textContent: "" },
        selection: { from: 3 },
        tr: { delete: vi.fn() },
      },
    };

    expect(editorOptions.editorProps.handleKeyDown(view, new KeyboardEvent("keydown", { key: "/" }))).toBe(true);
    expect(view.coordsAtPos).toHaveBeenCalledWith(3);
    expect(onOpenCommandMenu).toHaveBeenCalledWith({ bottom: 220, left: 140, top: 200 });
  });

  it("opens the command menu without inserting a slash after existing text", () => {
    const onOpenCommandMenu = vi.fn();
    render(
      <RichTextBlockEditor
        blockId="block-1"
        collaborationDocument={null}
        content="Release checklist"
        focusRequest={false}
        onChange={vi.fn()}
        onEnter={vi.fn()}
        onFocused={vi.fn()}
        onMarkdownShortcut={vi.fn()}
        onOpenCommandMenu={onOpenCommandMenu}
        variant="todo"
      />,
    );
    const editorOptions = tiptapMock.useEditor.mock.calls[0][0];
    const view = {
      coordsAtPos: vi.fn(() => ({ bottom: 220, left: 140, top: 200 })),
      dispatch: vi.fn(),
      state: {
        doc: { content: { size: 17 }, textContent: "Release checklist" },
        selection: { from: 18 },
        tr: { delete: vi.fn() },
      },
    };

    expect(editorOptions.editorProps.handleKeyDown(view, new KeyboardEvent("keydown", { key: "/" }))).toBe(true);
    expect(view.coordsAtPos).toHaveBeenCalledWith(18);
    expect(view.dispatch).not.toHaveBeenCalled();
    expect(onOpenCommandMenu).toHaveBeenCalledWith({ bottom: 220, left: 140, top: 200 });
  });

  it("does not overwrite focused local input with a delayed parent value", () => {
    const props = {
      blockId: "block-1",
      collaborationDocument: null,
      focusRequest: false,
      onChange: vi.fn(),
      onEnter: vi.fn(),
      onFocused: vi.fn(),
      onMarkdownShortcut: vi.fn(),
      onOpenCommandMenu: vi.fn(),
      variant: "paragraph" as const,
    };
    const { rerender } = render(<RichTextBlockEditor {...props} content="" />);

    tiptapMock.editor.isFocused = true;
    tiptapMock.editor.getText.mockReturnValue("最新输入");
    rerender(<RichTextBlockEditor {...props} content="较旧父值" />);

    expect(tiptapMock.editor.commands.setContent).not.toHaveBeenCalled();
  });

  it("does not write delayed parent content back into a populated collaboration fragment", () => {
    const ydoc = new Y.Doc();
    const fragment = ydoc.getXmlFragment("block-content:block-1");
    fragment.insert(0, [new Y.XmlElement("paragraph")]);
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
    tiptapMock.editor.getText.mockReturnValue("current CRDT content");
    const { rerender } = render(<RichTextBlockEditor {...props} content="current CRDT content" />);

    rerender(<RichTextBlockEditor {...props} content="delayed parent snapshot" />);

    expect(tiptapMock.editor.commands.setContent).not.toHaveBeenCalled();
  });

  it("hides the selection toolbar when the editor loses focus", () => {
    render(
      <TooltipProvider>
        <RichTextBlockEditor
          blockId="block-1"
          collaborationDocument={null}
          content="Selected"
          focusRequest={false}
          onChange={vi.fn()}
          onEnter={vi.fn()}
          onFocused={vi.fn()}
          onMarkdownShortcut={vi.fn()}
          onOpenCommandMenu={vi.fn()}
          variant="paragraph"
        />
      </TooltipProvider>,
    );
    const editorOptions = tiptapMock.useEditor.mock.calls[0][0];

    act(() => {
      editorOptions.onSelectionUpdate({
        editor: {
          state: { selection: { empty: false, from: 1, to: 4 } },
          view: { coordsAtPos: (position) => ({ left: position * 10, top: 80 }) },
        },
      });
    });
    expect(screen.getByRole("toolbar", { name: "Text formatting" })).toBeVisible();

    act(() => {
      editorOptions.onBlur();
    });
    expect(screen.queryByRole("toolbar", { name: "Text formatting" })).not.toBeInTheDocument();
  });

  it("only considers persisted content when an empty collaboration fragment first initializes", () => {
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
    tiptapMock.editor.commands.setContent.mockClear();

    rerender(<RichTextBlockEditor {...props} content="delayed parent snapshot" />);

    expect(tiptapMock.editor.commands.setContent).not.toHaveBeenCalled();
  });

  it("disables TipTap updates in read-only mode", () => {
    const onChange = vi.fn();

    render(
      <RichTextBlockEditor
        blockId="block-readonly"
        collaborationDocument={null}
        content="Read only"
        focusRequest={false}
        isReadOnly
        onChange={onChange}
        onEnter={vi.fn()}
        onFocused={vi.fn()}
        onMarkdownShortcut={vi.fn()}
        onOpenCommandMenu={vi.fn()}
        variant="paragraph"
      />,
    );

    const editorOptions = tiptapMock.useEditor.mock.calls[0][0];
    expect(editorOptions.editable).toBe(false);

    editorOptions.onUpdate({
      editor: {
        commands: { setContent: vi.fn() },
        getText: () => "Ignored update",
        getJSON: () => ({ content: [{ type: "paragraph" }], type: "doc" }),
      },
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
