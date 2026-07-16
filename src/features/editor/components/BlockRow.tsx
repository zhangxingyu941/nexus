import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { CollaborationDocument } from "../collaboration/collaborationTypes";
import type { Block, BlockData, BlockStatus, BlockType, MoveDirection } from "../model/block";
import { AttachmentBlockEditor } from "./blocks/AttachmentBlockEditor";
import { BlockCollabPopover } from "./blocks/BlockCollabPopover";
import { BlockCommentsPopover } from "./blocks/BlockCommentsPopover";
import { BlockControls } from "./blocks/BlockControls";
import { BlockInlineActions } from "./blocks/BlockInlineActions";
import { BlockMetaStrip } from "./blocks/BlockMetaStrip";
import { KanbanBlockEditor } from "./blocks/KanbanBlockEditor";
import { SLASH_COMMANDS } from "./blocks/blockMenuOptions";
import { SlashMenu } from "./blocks/SlashMenu";
import { TableBlockEditor } from "./blocks/TableBlockEditor";
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
  onChangeType: (blockId: string, type: BlockType) => void;
  onDelete: (blockId: string) => void;
  onFocused: () => void;
  onIndent: (blockId: string) => void;
  onMove: (blockId: string, direction: MoveDirection) => void;
  onOutdent: (blockId: string) => void;
  onResolveBlockComment: (blockId: string, commentId: string) => void;
  onToggleTodo: (blockId: string) => void;
  workspaceId: string;
}

type OpenMenu = "block" | "slash" | "collab" | "comments" | null;

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
  workspaceId,
}: BlockRowProps) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [activeSlashIndex, setActiveSlashIndex] = useState(0);
  const [commentDraft, setCommentDraft] = useState("");
  const rowRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (openMenu !== "slash") {
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

  const handleChangeType = (type: BlockType) => {
    setOpenMenu(null);
    onChangeType(block.id, type);
  };

  const openSlashMenu = () => {
    setActiveSlashIndex(0);
    setOpenMenu("slash");
  };

  const handleSlashMenuKeyDown = (event: ReactKeyboardEvent) => {
    if (openMenu !== "slash") {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      setActiveSlashIndex((current) => (current + 1) % SLASH_COMMANDS.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setActiveSlashIndex((current) => (current - 1 + SLASH_COMMANDS.length) % SLASH_COMMANDS.length);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      handleChangeType(SLASH_COMMANDS[activeSlashIndex].type);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpenMenu(null);
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
      data-block-depth={depth}
      data-testid={`block-row-${block.id}`}
      onKeyDownCapture={handleSlashMenuKeyDown}
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
            content={block.content}
            focusRequest={focusRequest}
            isReadOnly={isReadOnly}
            onChange={(content) => onChangeContent(block.id, content)}
            onEnter={() => onAddAfter(block.id)}
            onFocused={onFocused}
            onOpenCommandMenu={openSlashMenu}
            onToggle={() => onToggleTodo(block.id)}
          />
        ) : (
          <RichTextBlockEditor
            blockId={block.id}
            collaborationDocument={collaborationDocument}
            content={block.content}
            focusRequest={focusRequest}
            isReadOnly={isReadOnly}
            onChange={(content) => onChangeContent(block.id, content)}
            onEnter={() => onAddAfter(block.id)}
            onFocused={onFocused}
            onMarkdownShortcut={(type) => onChangeType(block.id, type)}
            onOpenCommandMenu={openSlashMenu}
            variant={block.type}
          />
        )}

        {block.type === "code" ? <span className="code-block-label">代码片段</span> : null}

        <BlockInlineActions
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

        {openMenu === "slash" ? <SlashMenu activeIndex={activeSlashIndex} onSelect={handleChangeType} /> : null}
      </div>
    </article>
  );
}
