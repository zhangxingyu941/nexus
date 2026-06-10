import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
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
  return (
    <article className={`block-row block-row-${block.type}`} data-testid={`block-row-${block.id}`}>
      <div className="block-controls">
        <select
          aria-label="块类型"
          className="block-type-select"
          onChange={(event) => onChangeType(block.id, event.target.value as BlockType)}
          value={block.type}
        >
          <option value="paragraph">段落</option>
          <option value="heading">标题</option>
          <option value="todo">待办</option>
        </select>
        <button
          aria-label="在下方添加块"
          className="icon-button"
          data-tooltip="添加"
          onClick={() => onAddAfter(block.id)}
          type="button"
        >
          <Plus aria-hidden="true" size={16} />
        </button>
        <button
          aria-label="上移块"
          className="icon-button"
          data-tooltip="上移"
          disabled={isFirst}
          onClick={() => onMove(block.id, "up")}
          type="button"
        >
          <ArrowUp aria-hidden="true" size={16} />
        </button>
        <button
          aria-label="下移块"
          className="icon-button"
          data-tooltip="下移"
          disabled={isLast}
          onClick={() => onMove(block.id, "down")}
          type="button"
        >
          <ArrowDown aria-hidden="true" size={16} />
        </button>
        <button
          aria-label="删除块"
          className="icon-button danger"
          data-tooltip="删除"
          onClick={() => onDelete(block.id)}
          type="button"
        >
          <Trash2 aria-hidden="true" size={16} />
        </button>
      </div>
      <div className="block-editor-shell">
        {block.type === "todo" ? (
          <TodoBlockEditor
            blockId={block.id}
            checked={block.checked}
            content={block.content}
            onChange={(content) => onChangeContent(block.id, content)}
            onEnter={() => onAddAfter(block.id)}
            onToggle={() => onToggleTodo(block.id)}
          />
        ) : (
          <RichTextBlockEditor
            blockId={block.id}
            content={block.content}
            onChange={(content) => onChangeContent(block.id, content)}
            onEnter={() => onAddAfter(block.id)}
            variant={block.type}
          />
        )}
      </div>
    </article>
  );
}
