import Collaboration from "@tiptap/extension-collaboration";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { CollaborationDocument } from "../collaboration/collaborationTypes";
import { getBlockCollaborationField } from "../collaboration/yjsWorkspaceMapping";
import type { BlockType } from "../model/block";
import { isSlashCommandTrigger, resolveMarkdownShortcut } from "./markdownShortcuts";

interface RichTextBlockEditorProps {
  blockId: string;
  collaborationDocument: CollaborationDocument | null;
  content: string;
  focusRequest: boolean;
  isReadOnly?: boolean;
  variant: "paragraph" | "heading" | "quote" | "code";
  onChange: (content: string) => void;
  onEnter: () => void;
  onFocused: () => void;
  onMarkdownShortcut: (type: BlockType) => void;
  onOpenCommandMenu: () => void;
}

export function RichTextBlockEditor({
  blockId,
  collaborationDocument,
  content,
  focusRequest,
  isReadOnly = false,
  variant,
  onChange,
  onEnter,
  onFocused,
  onMarkdownShortcut,
  onOpenCommandMenu,
}: RichTextBlockEditorProps) {
  const placeholder = {
    code: "输入代码",
    heading: "标题",
    paragraph: "输入内容",
    quote: "引用内容",
  }[variant];
  const collaborationField = useMemo(() => getBlockCollaborationField(blockId), [blockId]);
  const previousContentRef = useRef(content);
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: false,
        history: collaborationDocument ? false : undefined,
      }),
      ...(collaborationDocument
        ? [
            Collaboration.configure({
              document: collaborationDocument,
              field: collaborationField,
            }),
          ]
        : []),
      Placeholder.configure({
        placeholder,
      }),
    ],
    [collaborationDocument, collaborationField, placeholder],
  );

  const editor = useEditor({
    editable: !isReadOnly,
    extensions,
    content,
    editorProps: {
      attributes: {
        "aria-label": "块内容",
        "data-testid": `block-editor-${blockId}`,
        class: `rich-text-editor rich-text-editor-${variant}`,
      },
      handleKeyDown(view, event) {
        if (isReadOnly) {
          return false;
        }

        const shortcutType = resolveMarkdownShortcut(`${view.state.doc.textContent.trim()} `);

        if (event.key === " " && shortcutType) {
          event.preventDefault();
          view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
          onChange("");
          onMarkdownShortcut(shortcutType);
          return true;
        }

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
      if (isReadOnly) {
        return;
      }

      const text = activeEditor.getText();
      const shortcutType = resolveMarkdownShortcut(text);

      if (isSlashCommandTrigger(text)) {
        activeEditor.commands.setContent("");
        onChange("");
        onOpenCommandMenu();
        return;
      }

      if (shortcutType) {
        activeEditor.commands.setContent("");
        onChange("");
        onMarkdownShortcut(shortcutType);
        return;
      }

      // MVP 只持久化纯文本，为后续块模型和协同层保留简单边界。
      onChange(text);
    },
  }, [blockId, collaborationDocument, isReadOnly]);

  useEffect(() => {
    if (collaborationDocument) {
      return;
    }

    // 聚焦时 TipTap 是输入源，不能用延迟到达的父状态覆盖更新的本地文本。
    if (!editor || editor.getText() === content || editor.isFocused) {
      return;
    }

    // 外部状态恢复或类型切换后，同步 TipTap 内部文档，避免显示旧内容。
    editor.commands.setContent(content);
  }, [collaborationDocument, content, editor]);

  useEffect(() => {
    if (!collaborationDocument || !editor) {
      return;
    }

    const previousContent = previousContentRef.current;
    previousContentRef.current = content;

    if (editor.getText() === content) {
      return;
    }

    const fragment = collaborationDocument.getXmlFragment(collaborationField);

    if (fragment.length === 0) {
      if (content) {
        editor.commands.setContent(content);
      }
      return;
    }

    if (content !== previousContent) {
      editor.commands.setContent(content);
    }
  }, [collaborationDocument, collaborationField, content, editor]);

  useLayoutEffect(() => {
    if (!editor || !focusRequest || isReadOnly) {
      return;
    }

    editor.commands.focus("end");
    onFocused();
  }, [editor, focusRequest, isReadOnly, onFocused]);

  return <EditorContent editor={editor} />;
}
