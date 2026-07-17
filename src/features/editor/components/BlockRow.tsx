import type { CSSProperties, FocusEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchEditorCommands } from "../commands/editorCommands";
import type { EditorCommandDefinition } from "../commands/editorCommands";
import type { CollaborationDocument } from "../collaboration/collaborationTypes";
import type { Block, BlockData, BlockStatus, BlockType, HeadingLevel, MoveDirection } from "../model/block";
import type { EditorSessionUser } from "../session/sessionTypes";
import { getCursorColor } from "../collaboration/remoteCursorColors";
import { useMentionSearchContext } from "./MentionSearchContext";
import { AttachmentBlockEditor } from "./blocks/AttachmentBlockEditor";
import { BlockActionBar } from "./blocks/BlockActionBar";
import { BlockCollabPopover } from "./blocks/BlockCollabPopover";
import { BlockCommentsPopover } from "./blocks/BlockCommentsPopover";
import { BlockControls } from "./blocks/BlockControls";
import { BlockMetaStrip } from "./blocks/BlockMetaStrip";
import { KanbanBlockEditor } from "./blocks/KanbanBlockEditor";
import { TableBlockEditor } from "./blocks/TableBlockEditor";
import { EditorCommandPopover } from "./commands/EditorCommandPopover";
import type { EditorPopoverAnchor } from "./commands/EditorCommandPopover";
import { MentionPopover } from "./commands/MentionPopover";
import type { MentionItem } from "./commands/useMentionSearch";
import { RichTextBlockEditor } from "./RichTextBlockEditor";
import { TodoBlockEditor } from "./TodoBlockEditor";

interface BlockRowProps {
  block: Block;
  canIndent: boolean;
  canOutdent: boolean;
  collaborationDocument: CollaborationDocument | null;
  depth: number;
  focusRequest: boolean;
  isFirst: boolean;
  isLast: boolean;
  isReadOnly: boolean;
  onAddAfter: (blockId: string) => void;
  onAddBlockComment: (blockId: string, body: string) => void;
  onChangeBlockAssignee: (blockId: string, assignee: string) => void;
  onChangeBlockDueDate: (blockId: string, dueDate: string) => void;
  onChangeBlockStatus: (blockId: string, status: BlockStatus) => void;
  onChangeBlockData: (blockId: string, data: BlockData | null) => void;
  onChangeContent: (blockId: string, content: string) => void;
  onChangeType: (blockId: string, type: BlockType, headingLevel?: HeadingLevel) => void;
  onDelete: (blockId: string) => void;
  onFocused: () => void;
  onIndent: (blockId: string) => void;
  onMove: (blockId: string, direction: MoveDirection) => void;
  onOutdent: (blockId: string) => void;
  onResolveBlockComment: (blockId: string, commentId: string) => void;
  onToggleTodo: (blockId: string) => void;
  sessionUser: EditorSessionUser | null;
  workspaceId: string;
}

type OpenMenu = "block" | "slash" | "collab" | "comments" | "mention" | null;

export function BlockRow({
  block,
  canIndent,
  canOutdent,
  collaborationDocument,
  depth,
  focusRequest,
  isFirst,
  isLast,
  isReadOnly,
  onAddAfter,
  onAddBlockComment,
  onChangeBlockAssignee,
  onChangeBlockDueDate,
  onChangeBlockStatus,
  onChangeBlockData,
  onChangeContent,
  onChangeType,
  onDelete,
  onFocused,
  onIndent,
  onMove,
  onOutdent,
  onResolveBlockComment,
  onToggleTodo,
  sessionUser,
  workspaceId,
}: BlockRowProps) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [commentDraft, setCommentDraft] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [restoreEditorFocus, setRestoreEditorFocus] = useState(false);
  const [slashAnchor, setSlashAnchor] = useState<EditorPopoverAnchor | null>(null);
  const [slashQuery, setSlashQuery] = useState("");
  const [mentionAnchor, setMentionAnchor] = useState<EditorPopoverAnchor | null>(null);
  const [mentionQuery, setMentionQuery] = useState("");
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const mentionApiRef = useRef<{ insertMention: (item: MentionItem) => void } | null>(null);
  const rowRef = useRef<HTMLElement | null>(null);
  const slashCommands = useMemo(() => searchEditorCommands(slashQuery), [slashQuery]);
  const searchMentionItems = useMentionSearchContext();
  const mentionItems = useMemo(() => searchMentionItems(mentionQuery), [searchMentionItems, mentionQuery]);
  const cursorUser = useMemo(
    () => sessionUser
      ? { id: sessionUser.id, name: sessionUser.displayName || sessionUser.email, color: getCursorColor(sessionUser.id) }
      : undefined,
    [sessionUser],
  );

  // 从编辑器光标前的文本解析 @query，用于驱动提及菜单显隐与过滤。
  const syncMentionFromText = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const match = /@([^\s@]*)$/.exec(before);

    if (!match) {
      if (openMenu === "mention") {
        setOpenMenu(null);
      }
      return;
    }

    setMentionQuery(match[1]);
    setActiveMentionIndex(0);
    if (openMenu !== "mention") {
      const rowBounds = rowRef.current?.getBoundingClientRect();
      setMentionAnchor({
        bottom: rowBounds?.bottom ?? 40,
        left: (rowBounds?.left ?? 0) + 38,
        top: rowBounds?.top ?? 20,
      });
      setOpenMenu("mention");
    }
  };

  useEffect(() => {
    if (openMenu !== "slash" && openMenu !== "mention") {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rowRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

  const handleChangeType = (type: BlockType, headingLevel?: HeadingLevel) => {
    setOpenMenu(null);
    setRestoreEditorFocus(
      type === "paragraph" || type === "heading" || type === "todo" || type === "quote" || type === "code",
    );
    onChangeType(block.id, type, headingLevel);
  };

  const openSlashMenu = (anchor?: EditorPopoverAnchor) => {
    const rowBounds = rowRef.current?.getBoundingClientRect();
    setActiveSlashIndex(0);
    setSlashQuery("");
    setSlashAnchor(anchor ?? {
      bottom: rowBounds?.bottom ?? 40,
      left: (rowBounds?.left ?? 0) + 38,
      top: rowBounds?.top ?? 20,
    });
    setOpenMenu("slash");
  };

  const handleSelectCommand = (command: EditorCommandDefinition) => {
    handleChangeType(command.type, command.headingLevel);
  };

  const handleSlashMenuKeyDown = (event: ReactKeyboardEvent) => {
    if (openMenu !== "slash") {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      if (slashCommands.length > 0) {
        setActiveSlashIndex((current) => (current + 1) % slashCommands.length);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (slashCommands.length > 0) {
        setActiveSlashIndex((current) => (current - 1 + slashCommands.length) % slashCommands.length);
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const command = slashCommands[activeSlashIndex];
      if (command) {
        handleSelectCommand(command);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpenMenu(null);
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      setActiveSlashIndex(0);
      setSlashQuery((current) => current.slice(0, -1));
      return;
    }

    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      setActiveSlashIndex(0);
      setSlashQuery((current) => `${current}${event.key}`);
    }
  };

  const handleEditorFocused = () => {
    setRestoreEditorFocus(false);
    onFocused();
  };

  const openMentionMenu = (anchor?: EditorPopoverAnchor) => {
    const rowBounds = rowRef.current?.getBoundingClientRect();
    setActiveMentionIndex(0);
    setMentionQuery("");
    setMentionAnchor(anchor ?? {
      bottom: rowBounds?.bottom ?? 40,
      left: (rowBounds?.left ?? 0) + 38,
      top: rowBounds?.top ?? 20,
    });
    setOpenMenu("mention");
  };

  const handleSelectMention = (item: MentionItem) => {
    setOpenMenu(null);
    mentionApiRef.current?.insertMention(item);
  };

  const handleMentionMenuKeyDown = (event: ReactKeyboardEvent) => {
    if (openMenu !== "mention") {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      if (mentionItems.length > 0) {
        setActiveMentionIndex((current) => (current + 1) % mentionItems.length);
      }
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (mentionItems.length > 0) {
        setActiveMentionIndex((current) => (current - 1 + mentionItems.length) % mentionItems.length);
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const item = mentionItems[activeMentionIndex];
      if (item) {
        handleSelectMention(item);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpenMenu(null);
      return;
    }
  };

  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setIsActive(false);
    }
  };

  const handleMove = (direction: MoveDirection) => {
    setOpenMenu(null);
    onMove(block.id, direction);
  };

  const handleDelete = () => {
    setOpenMenu(null);
    onDelete(block.id);
  };

  const handleSubmitComment = () => {
    const body = commentDraft.trim();

    if (!body) {
      return;
    }

    onAddBlockComment(block.id, body);
    setCommentDraft("");
  };

  return (
    <article
      className={`block-row block-row-${block.type}${openMenu ? " block-row-menu-open" : ""}`}
      data-active={isActive || openMenu !== null}
      data-block-depth={depth}
      data-heading-level={block.headingLevel}
      data-testid={`block-row-${block.id}`}
      onBlurCapture={handleBlur}
      onFocusCapture={() => setIsActive(true)}
      onKeyDownCapture={(event) => {
        handleSlashMenuKeyDown(event);
        handleMentionMenuKeyDown(event);
      }}
      ref={rowRef}
      style={{ "--block-depth": Math.min(depth, 6) } as CSSProperties}
    >
      {!isReadOnly ? (
        <BlockControls
          blockId={block.id}
          canIndent={canIndent}
          canOutdent={canOutdent}
          isFirst={isFirst}
          isLast={isLast}
          isMenuOpen={openMenu === "block"}
          onAddAfter={onAddAfter}
          onChangeType={handleChangeType}
          onDelete={handleDelete}
          onIndent={() => onIndent(block.id)}
          onMenuOpenChange={(open) => setOpenMenu(open ? "block" : null)}
          onMove={handleMove}
          onOutdent={() => onOutdent(block.id)}
        />
      ) : <span aria-hidden="true" className="readonly-block-gutter" />}

      <div className="block-editor-shell">
        {block.type === "image" || block.type === "file" ? (
          <AttachmentBlockEditor
            content={block.content}
            data={block.data?.kind === block.type ? block.data : null}
            isReadOnly={isReadOnly}
            kind={block.type}
            onChangeContent={(content) => onChangeContent(block.id, content)}
            onChangeData={(data) => onChangeBlockData(block.id, data)}
            workspaceId={workspaceId}
          />
        ) : block.type === "table" ? (
          block.data?.kind === "table" ? (
            <TableBlockEditor
              data={block.data}
              isReadOnly={isReadOnly}
              onChange={(data) => onChangeBlockData(block.id, data)}
            />
          ) : null
        ) : block.type === "kanban" ? (
          block.data?.kind === "kanban" ? (
            <KanbanBlockEditor
              data={block.data}
              isReadOnly={isReadOnly}
              onChange={(data) => onChangeBlockData(block.id, data)}
            />
          ) : null
        ) : block.type === "todo" ? (
          <TodoBlockEditor
            blockId={block.id}
            checked={block.checked}
            collaborationDocument={collaborationDocument}
            content={block.content}
            focusRequest={focusRequest || restoreEditorFocus}
            isReadOnly={isReadOnly}
            onChange={(content) => {
              syncMentionFromText(content, content.length);
              onChangeContent(block.id, content);
            }}
            onEnter={() => onAddAfter(block.id)}
            onFocused={handleEditorFocused}
            onMarkdownShortcut={(type, headingLevel) => onChangeType(block.id, type, headingLevel)}
            onOpenCommandMenu={openSlashMenu}
            onOpenMentionMenu={openMentionMenu}
            onMentionApiReady={(api) => { mentionApiRef.current = api; }}
            onToggle={() => onToggleTodo(block.id)}
            sessionUser={cursorUser}
          />
        ) : (
          <RichTextBlockEditor
            blockId={block.id}
            collaborationDocument={collaborationDocument}
            content={block.content}
            focusRequest={focusRequest || restoreEditorFocus}
            isReadOnly={isReadOnly}
            onChange={(content) => {
              syncMentionFromText(content, content.length);
              onChangeContent(block.id, content);
            }}
            onEnter={() => onAddAfter(block.id)}
            onFocused={handleEditorFocused}
            onMarkdownShortcut={(type, headingLevel) => onChangeType(block.id, type, headingLevel)}
            onOpenCommandMenu={openSlashMenu}
            onOpenMentionMenu={openMentionMenu}
            onMentionApiReady={(api) => { mentionApiRef.current = api; }}
            sessionUser={cursorUser}
            variant={block.type}
          />
        )}

        {block.type === "code" ? <span className="code-block-label">代码片段</span> : null}

        <BlockActionBar
          block={block}
          collabContent={(
            <BlockCollabPopover
              block={block}
              onChangeAssignee={onChangeBlockAssignee}
              onChangeDueDate={onChangeBlockDueDate}
              onChangeStatus={onChangeBlockStatus}
            />
          )}
          commentsContent={(
            <BlockCommentsPopover
              block={block}
              commentDraft={commentDraft}
              isReadOnly={isReadOnly}
              onChangeCommentDraft={setCommentDraft}
              onResolveComment={onResolveBlockComment}
              onSubmitComment={handleSubmitComment}
            />
          )}
          isReadOnly={isReadOnly}
          isCollabOpen={openMenu === "collab"}
          isCommentsOpen={openMenu === "comments"}
          onCollabOpenChange={(open) => setOpenMenu(open ? "collab" : null)}
          onCommentsOpenChange={(open) => setOpenMenu(open ? "comments" : null)}
        />

        <BlockMetaStrip block={block} />

        {openMenu === "slash" && slashAnchor ? (
          <EditorCommandPopover
            activeIndex={activeSlashIndex}
            anchor={slashAnchor}
            commands={slashCommands}
            onSelect={handleSelectCommand}
            query={slashQuery}
          />
        ) : null}

        {openMenu === "mention" && mentionAnchor ? (
          <MentionPopover
            activeIndex={activeMentionIndex}
            anchor={mentionAnchor}
            items={mentionItems}
            onSelect={handleSelectMention}
            query={mentionQuery}
          />
        ) : null}
      </div>
    </article>
  );
}
