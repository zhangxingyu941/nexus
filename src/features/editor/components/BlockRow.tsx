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
          aria-label="Block type"
          className="block-type-select"
          onChange={(event) => onChangeType(block.id, event.target.value as BlockType)}
          value={block.type}
        >
          <option value="paragraph">Paragraph</option>
          <option value="heading">Heading</option>
          <option value="todo">Todo</option>
        </select>
        <button aria-label="Add block after" className="icon-button" onClick={() => onAddAfter(block.id)} type="button">
          <Plus aria-hidden="true" size={16} />
        </button>
        <button
          aria-label="Move block up"
          className="icon-button"
          disabled={isFirst}
          onClick={() => onMove(block.id, "up")}
          type="button"
        >
          <ArrowUp aria-hidden="true" size={16} />
        </button>
        <button
          aria-label="Move block down"
          className="icon-button"
          disabled={isLast}
          onClick={() => onMove(block.id, "down")}
          type="button"
        >
          <ArrowDown aria-hidden="true" size={16} />
        </button>
        <button aria-label="Delete block" className="icon-button danger" onClick={() => onDelete(block.id)} type="button">
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
