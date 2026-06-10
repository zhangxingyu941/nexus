import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect } from "react";

interface RichTextBlockEditorProps {
  blockId: string;
  content: string;
  variant: "paragraph" | "heading";
  onChange: (content: string) => void;
  onEnter: () => void;
}

export function RichTextBlockEditor({
  blockId,
  content,
  variant,
  onChange,
  onEnter,
}: RichTextBlockEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Placeholder.configure({
        placeholder: variant === "heading" ? "Heading" : "Write",
      }),
    ],
    content,
    editorProps: {
      attributes: {
        "aria-label": "Block content",
        "data-testid": `block-editor-${blockId}`,
        class: `rich-text-editor rich-text-editor-${variant}`,
      },
      handleKeyDown(_, event) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onEnter();
          return true;
        }

        return false;
      },
    },
    onUpdate({ editor: activeEditor }) {
      onChange(activeEditor.getText());
    },
  });

  useEffect(() => {
    if (!editor || editor.getText() === content) {
      return;
    }

    editor.commands.setContent(content);
  }, [content, editor]);

  return <EditorContent editor={editor} />;
}
