import { ArrowDown, ArrowUp, GripVertical, Heading1, ListTodo, Plus, Trash2, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Block, BlockType } from "../model/block";
import { RichTextBlockEditor } from "./RichTextBlockEditor";
import { TodoBlockEditor } from "./TodoBlockEditor";

interface BlockRowProps {
  block: Block;
  isFirst: boolean;
  isLast: boolean;
  onAddAfter: (blockId: string) => void;
  onChangeContent: (blockId: string, content: string) => void;
  onChangeType: (blockId: string, type: BlockType) => void;
  onDelete: (blockId: string) => void;
  onMove: (blockId: string, direction: "up" | "down") => void;
  onToggleTodo: (blockId: string) => void;
}

type OpenMenu = "block" | "slash" | null;

export function BlockRow({
  block,
  isFirst,
  isLast,
  onAddAfter,
  onChangeContent,
  onChangeType,
  onDelete,
  onMove,
  onToggleTodo,
}: BlockRowProps) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const rowRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!openMenu) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rowRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
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

  const handleMove = (direction: "up" | "down") => {
    setOpenMenu(null);
    onMove(block.id, direction);
  };

  const handleDelete = () => {
    setOpenMenu(null);
    onDelete(block.id);
  };

  return (
    <article
      className={`block-row block-row-${block.type}${openMenu ? " block-row-menu-open" : ""}`}
      data-testid={`block-row-${block.id}`}
      ref={rowRef}
    >
      <div aria-label="块操作" className="block-controls">
        <button
          aria-label="在下方添加块"
          className="block-gutter-button"
          data-tooltip="添加块"
          onClick={() => onAddAfter(block.id)}
          type="button"
        >
          <Plus aria-hidden="true" size={16} />
        </button>
        <button
          aria-expanded={openMenu === "block"}
          aria-haspopup="menu"
          aria-label="打开块菜单"
          className="block-gutter-button"
          data-tooltip="块菜单"
          onClick={() => setOpenMenu((current) => (current === "block" ? null : "block"))}
          type="button"
        >
          <GripVertical aria-hidden="true" size={16} />
        </button>

        {openMenu === "block" ? (
          <div aria-label="块菜单" className="block-menu" role="menu">
            <button aria-label="转为段落" onClick={() => handleChangeType("paragraph")} role="menuitem" type="button">
              <Type aria-hidden="true" size={15} />
              <span>转为段落</span>
            </button>
            <button aria-label="转为标题" onClick={() => handleChangeType("heading")} role="menuitem" type="button">
              <Heading1 aria-hidden="true" size={15} />
              <span>转为标题</span>
            </button>
            <button aria-label="转为待办" onClick={() => handleChangeType("todo")} role="menuitem" type="button">
              <ListTodo aria-hidden="true" size={15} />
              <span>转为待办</span>
            </button>
            <span className="block-menu-divider" />
            <button
              aria-label="上移块"
              disabled={isFirst}
              onClick={() => handleMove("up")}
              role="menuitem"
              type="button"
            >
              <ArrowUp aria-hidden="true" size={15} />
              <span>上移块</span>
            </button>
            <button
              aria-label="下移块"
              disabled={isLast}
              onClick={() => handleMove("down")}
              role="menuitem"
              type="button"
            >
              <ArrowDown aria-hidden="true" size={15} />
              <span>下移块</span>
            </button>
            <button aria-label="删除块" className="danger" onClick={handleDelete} role="menuitem" type="button">
              <Trash2 aria-hidden="true" size={15} />
              <span>删除块</span>
            </button>
          </div>
        ) : null}
      </div>
      <div className="block-editor-shell">
        {block.type === "todo" ? (
          <TodoBlockEditor
            blockId={block.id}
            checked={block.checked}
            content={block.content}
            onChange={(content) => onChangeContent(block.id, content)}
            onEnter={() => onAddAfter(block.id)}
            onOpenCommandMenu={() => setOpenMenu("slash")}
            onToggle={() => onToggleTodo(block.id)}
          />
        ) : (
          <RichTextBlockEditor
            blockId={block.id}
            content={block.content}
            onChange={(content) => onChangeContent(block.id, content)}
            onEnter={() => onAddAfter(block.id)}
            onOpenCommandMenu={() => setOpenMenu("slash")}
            variant={block.type}
          />
        )}

        {openMenu === "slash" ? (
          <div aria-label="插入菜单" className="slash-menu" role="menu">
            <button aria-label="段落" onClick={() => handleChangeType("paragraph")} role="menuitem" type="button">
              <Type aria-hidden="true" size={15} />
              <span>段落</span>
            </button>
            <button aria-label="标题" onClick={() => handleChangeType("heading")} role="menuitem" type="button">
              <Heading1 aria-hidden="true" size={15} />
              <span>标题</span>
            </button>
            <button aria-label="待办" onClick={() => handleChangeType("todo")} role="menuitem" type="button">
              <ListTodo aria-hidden="true" size={15} />
              <span>待办</span>
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}
