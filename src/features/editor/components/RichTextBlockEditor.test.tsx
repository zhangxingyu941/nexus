import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
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
  content: string;
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
  onUpdate: (payload: {
    editor: {
      commands: {
        setContent: (content: string) => void;
      };
      getText: () => string;
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
    expect(editorOptions.content).toBe("Initial content");
    expect(editorOptions.extensions[0].options.history).toBe(false);
    expect(tiptapMock.useEditor.mock.calls[0][1]).toEqual(["block-1", ydoc, false]);
  });

  it("reports plain text updates to the workspace state", () => {
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
      },
    });

    expect(onChange).toHaveBeenCalledWith("Updated content");
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
      },
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
