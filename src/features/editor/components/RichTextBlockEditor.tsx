import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useCollaborationSession } from "../collaboration/CollaborationSessionContext";
import { getCursorColor } from "../collaboration/remoteCursorColors";
import type { CollaborationDocument } from "../collaboration/collaborationTypes";
import { getBlockCollaborationField } from "../collaboration/yjsWorkspaceMapping";
import type { BlockType, HeadingLevel } from "../model/block";
import { isSlashCommandTrigger, resolveMarkdownShortcut } from "./markdownShortcuts";
import type { EditorPopoverAnchor } from "./commands/EditorCommandPopover";
import type { MentionItem } from "./commands/useMentionSearch";
import Mention from "../extensions/mention";

interface RichTextBlockEditorProps {
  ariaLabel?: string;
  blockId: string;
  collaborationDocument: CollaborationDocument | null;
  content: string;
  focusRequest: boolean;
  isReadOnly?: boolean;
  sessionUser?: { id: string; name: string; color: string };
  variant: "paragraph" | "heading" | "quote" | "code" | "todo";
  onChange: (content: string) => void;
  onEnter: () => void;
  onFocused: () => void;
  onMarkdownShortcut: (type: BlockType, headingLevel?: HeadingLevel) => void;
  onOpenCommandMenu: (anchor: EditorPopoverAnchor) => void;
  onOpenMentionMenu?: (anchor: EditorPopoverAnchor) => void;
  onMentionApiReady?: (api: { insertMention: (item: MentionItem) => void }) => void;
}

export function RichTextBlockEditor({
  ariaLabel = "块内容",
  blockId,
  collaborationDocument,
  content,
  focusRequest,
  isReadOnly = false,
  sessionUser,
  variant,
  onChange,
  onEnter,
  onFocused,
  onMarkdownShortcut,
  onOpenCommandMenu,
  onOpenMentionMenu,
  onMentionApiReady,
}: RichTextBlockEditorProps) {
  const { provider } = useCollaborationSession();
  const placeholder = {
    code: "输入代码",
    heading: "标题",
    paragraph: "输入内容",
    quote: "引用内容",
    todo: "待办内容",
  }[variant];
  const collaborationField = useMemo(() => getBlockCollaborationField(blockId), [blockId]);
  const initializedCollaborationRef = useRef<{
    document: CollaborationDocument;
    field: string;
  } | null>(null);
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
      ...(provider && sessionUser
        ? [
            CollaborationCursor.configure({
              provider,
              user: {
                name: sessionUser.name,
                color: getCursorColor(sessionUser.id),
              },
            }),
          ]
        : []),
      Mention,
      Placeholder.configure({
        placeholder,
      }),
    ],
    [collaborationDocument, collaborationField, placeholder, provider, sessionUser],
  );

  const editor = useEditor({
    editable: !isReadOnly,
    extensions,
    content,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        "data-testid": `block-editor-${blockId}`,
        class: `rich-text-editor rich-text-editor-${variant}`,
      },
      handleKeyDown(view, event) {
        if (isReadOnly) {
          return false;
        }

        const shortcutCommand = resolveMarkdownShortcut(`${view.state.doc.textContent.trim()} `);

        if (event.key === " " && shortcutCommand) {
          event.preventDefault();
          view.dispatch(view.state.tr.delete(0, view.state.doc.content.size));
          onChange("");
          onMarkdownShortcut(shortcutCommand.type, shortcutCommand.headingLevel);
          return true;
        }

        // 仅当块内容为空时，输入 / 触发块插入菜单；否则按普通字符输入。
        if (event.key === "/" && view.state.doc.textContent.length === 0) {
          event.preventDefault();
          const caret = view.coordsAtPos(view.state.selection.from);
          onOpenCommandMenu({ bottom: caret.bottom, left: caret.left, top: caret.top });
          return true;
        }

        // 输入 @ 打开提及菜单，但不拦截字符，后续输入作为过滤词留在正文。
        if (event.key === "@" && onOpenMentionMenu) {
          const caret = view.coordsAtPos(view.state.selection.from);
          onOpenMentionMenu({ bottom: caret.bottom, left: caret.left, top: caret.top });
          return false;
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
      const shortcutCommand = resolveMarkdownShortcut(text);

      if (isSlashCommandTrigger(text)) {
        const caret = activeEditor.view.coordsAtPos(activeEditor.state.selection.from);
        activeEditor.commands.setContent("");
        onChange("");
        onOpenCommandMenu({ bottom: caret.bottom, left: caret.left, top: caret.top });
        return;
      }

      if (shortcutCommand) {
        activeEditor.commands.setContent("");
        onChange("");
        onMarkdownShortcut(shortcutCommand.type, shortcutCommand.headingLevel);
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
    if (!editor || !onMentionApiReady) {
      return;
    }

    onMentionApiReady({
      insertMention(item: MentionItem) {
        const { state, view } = editor;
        const from = state.selection.from;
        const textBefore = state.doc.textBetween(0, from, "\n", "\0");
        const match = /@([^\s@]*)$/.exec(textBefore);

        if (!match) {
          return;
        }

        const start = from - match[0].length;
        const mentionNode = state.schema.nodes.mention.create({
          kind: item.kind,
          label: item.label,
          targetId: item.id,
        });
        const tr = state.tr
          .delete(start, from)
          .insert(start, mentionNode)
          .insertText(" ");
        view.dispatch(tr);
        view.focus();
      },
    });
  }, [editor, onMentionApiReady]);

  useEffect(() => {
    if (!collaborationDocument) {
      initializedCollaborationRef.current = null;
      return;
    }

    if (!editor) {
      return;
    }

    const initializedCollaboration = initializedCollaborationRef.current;

    if (
      initializedCollaboration?.document === collaborationDocument &&
      initializedCollaboration.field === collaborationField
    ) {
      return;
    }

    initializedCollaborationRef.current = {
      document: collaborationDocument,
      field: collaborationField,
    };

    const fragment = collaborationDocument.getXmlFragment(collaborationField);

    // Seed persisted text once. After initialization the Yjs fragment is the only collaborative text source.
    if (fragment.length === 0 && content && editor.getText() !== content) {
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
