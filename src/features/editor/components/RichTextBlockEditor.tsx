import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCollaborationSession } from "../collaboration/CollaborationSessionContext";
import { getCursorColor } from "../collaboration/remoteCursorColors";
import type { CollaborationDocument } from "../collaboration/collaborationTypes";
import { getBlockCollaborationField } from "../collaboration/yjsWorkspaceMapping";
import type { BlockType, HeadingLevel } from "../model/block";
import {
  createRichTextFromPlainText,
  normalizeRichText,
  projectRichTextContent,
  type RichTextDocument,
  type RichTextUpdate,
} from "@/shared/richText";
import { isSlashCommandTrigger, resolveMarkdownShortcut } from "./markdownShortcuts";
import type { EditorPopoverAnchor } from "./commands/EditorCommandPopover";
import type { MentionItem } from "./commands/useMentionSearch";
import { SelectionToolbar } from "./commands/SelectionToolbar";
import { LinkPopover } from "./commands/LinkPopover";
import Mention from "../extensions/mention";
import {
  NEXUS_RICH_TEXT_CLIPBOARD_TYPE,
  parseRichTextClipboard,
} from "./richTextPaste";

interface RichTextBlockEditorCommonProps {
  ariaLabel?: string;
  blockId: string;
  collaborationDocument: CollaborationDocument | null;
  content: string;
  focusRequest: boolean;
  isReadOnly?: boolean;
  sessionUser?: { id: string; name: string; color: string };
  onEnter: () => void;
  onFocused: () => void;
  onMarkdownShortcut: (type: BlockType, headingLevel?: HeadingLevel) => void;
  onOpenCommandMenu: (anchor: EditorPopoverAnchor) => void;
  onOpenMentionMenu?: (anchor: EditorPopoverAnchor) => void;
  onMentionApiReady?: (api: { insertMention: (item: MentionItem) => void }) => void;
  onComment?: (selectedText: string) => void;
}

type RichTextBlockEditorProps = RichTextBlockEditorCommonProps & (
  | {
      onChange: (content: string) => void;
      richText?: null;
      variant: "code";
    }
  | {
      onChange: (update: RichTextUpdate) => void;
      richText?: RichTextDocument | null;
      variant: "paragraph" | "heading" | "quote" | "todo";
    }
);

export function RichTextBlockEditor({
  ariaLabel = "块内容",
  blockId,
  collaborationDocument,
  content,
  richText,
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
  onComment,
}: RichTextBlockEditorProps) {
  const { provider } = useCollaborationSession();
  const [selectionAnchor, setSelectionAnchor] = useState<{ left: number; top: number } | null>(null);
  const [selectionRange, setSelectionRange] = useState<{ from: number; to: number } | null>(null);
  const [linkPopover, setLinkPopover] = useState<{
    anchor: { left: number; top: number };
    href: string;
    range: { from: number; to: number };
  } | null>(null);
  const placeholder = {
    code: "输入代码",
    heading: "标题",
    paragraph: "输入内容",
    quote: "引用内容",
    todo: "待办内容",
  }[variant];
  const collaborationField = useMemo(() => getBlockCollaborationField(blockId), [blockId]);
  const initialRichText = useMemo(
    () => variant === "code" ? null : resolveRichText(richText, content),
    [content, richText, variant],
  );
  const editorContent = variant === "code" ? content : initialRichText;
  const initializedCollaborationRef = useRef<{
    document: CollaborationDocument;
    editor: unknown;
    field: string;
  } | null>(null);
  const emitChange = (nextContent: string) => {
    if (variant === "code") {
      onChange(nextContent);
      return;
    }

    onChange({
      content: nextContent,
      richText: createRichTextFromPlainText(nextContent),
    });
  };
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: false,
        history: collaborationDocument ? false : undefined,
        ...(variant === "code" ? {
          bold: false,
          code: false,
          italic: false,
          strike: false,
        } : {}),
      }),
      ...(variant === "code" ? [] : [Link.configure({ openOnClick: false })]),
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
              render: (user) => {
                const color = (user?.color as string) ?? "#2563eb";
                const isLocal = typeof user?.clientId === "number" && user.clientId === provider.awareness.clientID;

                const cursor = document.createElement("span");
                cursor.classList.add("collaboration-cursor__caret");
                cursor.style.borderColor = color;

                if (!isLocal) {
                  const label = document.createElement("div");
                  label.classList.add("collaboration-cursor__label");
                  label.style.backgroundColor = color;
                  label.textContent = (user?.name as string) || "";
                  cursor.appendChild(label);
                }

                return cursor;
              },
              selectionRender: (user) => {
                const color = (user?.color as string) ?? "#2563eb";

                return {
                  class: "collaboration-cursor__selection",
                  style: `background-color: ${color}33`,
                };
              },
              user: {
                clientId: provider.awareness.clientID,
                color: getCursorColor(sessionUser.id),
                name: sessionUser.name,
              },
            }),
          ]
        : []),
      ...(variant === "code" ? [] : [Mention]),
      Placeholder.configure({
        placeholder,
      }),
    ],
    [collaborationDocument, collaborationField, placeholder, provider, sessionUser, variant],
  );

  const editor = useEditor({
    editable: !isReadOnly,
    extensions,
    content: editorContent,
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
          emitChange("");
          onMarkdownShortcut(shortcutCommand.type, shortcutCommand.headingLevel);
          return true;
        }

        // Keep existing text intact while opening the caret-anchored insert menu.
        if (event.key === "/") {
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
      handlePaste(_view, event) {
        if (variant === "code" || !event.clipboardData) {
          return false;
        }

        event.preventDefault();
        const pasted = parseRichTextClipboard(event.clipboardData);
        queueMicrotask(() => {
          editor?.chain().focus().insertContent(pasted.content[0].content ?? []).run();
        });
        return true;
      },
      handleDOMEvents: {
        copy(view, event) {
          if (variant === "code" || !event.clipboardData) {
            return false;
          }

          try {
            const { from, to } = view.state.selection;
            const selected = view.state.doc.slice(from, to).content.toJSON();
            const copied = normalizeRichText({
              content: [{ ...(selected.length > 0 ? { content: selected } : {}), type: "paragraph" }],
              type: "doc",
            });
            event.clipboardData.setData(NEXUS_RICH_TEXT_CLIPBOARD_TYPE, JSON.stringify(copied));
          } catch {
            // The browser's ordinary text and HTML clipboard formats remain available.
          }
          return false;
        },
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
        emitChange("");
        onOpenCommandMenu({ bottom: caret.bottom, left: caret.left, top: caret.top });
        return;
      }

      if (shortcutCommand) {
        activeEditor.commands.setContent("");
        emitChange("");
        onMarkdownShortcut(shortcutCommand.type, shortcutCommand.headingLevel);
        return;
      }

      // MVP 只持久化纯文本，为后续块模型和协同层保留简单边界。
      if (variant === "code") {
        emitChange(text);
        return;
      }

      try {
        const nextRichText = normalizeRichText(activeEditor.getJSON());
        onChange({
          content: projectRichTextContent(nextRichText),
          richText: nextRichText,
        });
      } catch {
        emitChange(text);
      }
    },
    onSelectionUpdate({ editor: activeEditor }) {
      if (isReadOnly) {
        setSelectionAnchor(null);
        setSelectionRange(null);
        return;
      }

      const { from, to, empty } = activeEditor.state.selection;

      if (empty || from === to) {
        setSelectionAnchor(null);
        setSelectionRange(null);
        return;
      }

      const start = activeEditor.view.coordsAtPos(from);
      const end = activeEditor.view.coordsAtPos(to);
      const left = (start.left + end.left) / 2;
      const top = Math.min(start.top, end.top) - 8;

      setSelectionAnchor({ left, top });
      setSelectionRange({ from, to });
    },
    onBlur() {
      setSelectionAnchor(null);
      setSelectionRange(null);
    },
  }, [blockId, collaborationDocument, isReadOnly]);

  useEffect(() => {
    if (collaborationDocument) {
      return;
    }

    // 聚焦时 TipTap 是输入源，不能用延迟到达的父状态覆盖更新的本地文本。
    if (!editor || editor.isFocused) {
      return;
    }

    // 外部状态恢复或类型切换后，同步 TipTap 内部文档，避免显示旧内容。
    if (variant === "code") {
      if (editor.getText() !== content) {
        editor.commands.setContent(content);
      }
      return;
    }

    const currentRichText = getEditorRichText(editor);
    if (currentRichText && JSON.stringify(currentRichText) === JSON.stringify(initialRichText)) {
      return;
    }

    editor.commands.setContent(initialRichText);
  }, [collaborationDocument, content, editor, initialRichText, variant]);

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
      initializedCollaboration.editor === editor &&
      initializedCollaboration.field === collaborationField
    ) {
      return;
    }

    initializedCollaborationRef.current = {
      document: collaborationDocument,
      editor,
      field: collaborationField,
    };

    const fragment = collaborationDocument.getXmlFragment(collaborationField);

    // Seed persisted text once. After initialization the Yjs fragment is the only collaborative text source.
    if (fragment.length === 0) {
      editor.commands.setContent(editorContent);
    }
  }, [collaborationDocument, collaborationField, editor, editorContent]);

  useLayoutEffect(() => {
    if (!editor || !focusRequest || isReadOnly) {
      return;
    }

    editor.commands.focus("end");
    onFocused();
  }, [editor, focusRequest, isReadOnly, onFocused]);

  return (
    <>
      <EditorContent editor={editor} />
      {variant !== "code" ? <SelectionToolbar
        activeMarks={{
          bold: Boolean(editor?.isActive?.("bold")),
          code: Boolean(editor?.isActive?.("code")),
          italic: Boolean(editor?.isActive?.("italic")),
          link: Boolean(editor?.isActive?.("link")),
          strike: Boolean(editor?.isActive?.("strike")),
        }}
        anchor={selectionAnchor}
        onBold={() => editor?.chain().focus().toggleBold().run()}
        onCode={() => editor?.chain().focus().toggleCode().run()}
        onComment={onComment ? () => onComment(editor?.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ") ?? "") : undefined}
        onItalic={() => editor?.chain().focus().toggleItalic().run()}
        onLink={() => {
          if (!editor || !selectionAnchor || !selectionRange) {
            return;
          }
          const href = editor.getAttributes("link").href;
          setSelectionAnchor(null);
          setSelectionRange(null);
          setLinkPopover({
            anchor: selectionAnchor,
            href: typeof href === "string" ? href : "",
            range: selectionRange,
          });
        }}
        onStrike={() => editor?.chain().focus().toggleStrike().run()}
      /> : null}
      {linkPopover ? <LinkPopover
        anchor={linkPopover.anchor}
        initialHref={linkPopover.href}
        onClose={() => {
          setLinkPopover(null);
          editor?.chain().focus().setTextSelection(linkPopover.range).run();
        }}
        onSubmit={(href) => {
          const chain = editor?.chain().focus().setTextSelection(linkPopover.range);
          if (!chain) {
            return;
          }
          if (href) {
            chain.setLink({ href }).run();
          } else {
            chain.extendMarkRange("link").unsetLink().run();
          }
        }}
      /> : null}
    </>
  );
}

function resolveRichText(value: RichTextDocument | null | undefined, content: string) {
  try {
    return normalizeRichText(value ?? createRichTextFromPlainText(content));
  } catch {
    return createRichTextFromPlainText(content);
  }
}

function getEditorRichText(editor: { getJSON: () => unknown }) {
  try {
    return normalizeRichText(editor.getJSON());
  } catch {
    return null;
  }
}
