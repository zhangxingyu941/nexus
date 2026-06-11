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
  onOpenCommandMenu: () => void;
}

export function RichTextBlockEditor({
  blockId,
  content,
  variant,
  onChange,
  onEnter,
  onOpenCommandMenu,
}: RichTextBlockEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Placeholder.configure({
        placeholder: variant === "heading" ? "标题" : "输入内容",
      }),
    ],
    content,
    editorProps: {
      attributes: {
        "aria-label": "块内容",
        "data-testid": `block-editor-${blockId}`,
        class: `rich-text-editor rich-text-editor-${variant}`,
      },
      handleKeyDown(_, event) {
        // 输入 / 时打开块插入菜单，并避免把触发符留在正文里。
        if (event.key === "/") {
          event.preventDefault();
          onOpenCommandMenu();
          return true;
        }

        // 第一版把 Enter 作为“新增下一个块”，不让 TipTap 在块内继续分段。
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          onEnter();
          return true;
        }

        return false;
      },
    },
    onUpdate({ editor: activeEditor }) {
      // MVP 只持久化纯文本，为后续块模型和协同层保留简单边界。
      onChange(activeEditor.getText());
    },
  });

  useEffect(() => {
    // 外部状态恢复或类型切换后，同步 TipTap 内部文档，避免显示旧内容。
    if (!editor || editor.getText() === content) {
      return;
    }

    editor.commands.setContent(content);
  }, [content, editor]);

  return <EditorContent editor={editor} />;
}
