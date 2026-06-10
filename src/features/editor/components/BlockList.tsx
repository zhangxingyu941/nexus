import type { Block, BlockType } from "../model/block";
import { BlockRow } from "./BlockRow";

interface BlockListProps {
  blocks: Block[];
  onAddAfter: (blockId: string) => void;
  onChangeContent: (blockId: string, content: string) => void;
  onChangeType: (blockId: string, type: BlockType) => void;
  onDelete: (blockId: string) => void;
  onMove: (blockId: string, direction: "up" | "down") => void;
  onToggleTodo: (blockId: string) => void;
}

export function BlockList({
  blocks,
  onAddAfter,
  onChangeContent,
  onChangeType,
  onDelete,
  onMove,
  onToggleTodo,
}: BlockListProps) {
  return (
    <div className="block-list">
      {blocks.map((block, index) => (
        <BlockRow
          block={block}
          isFirst={index === 0}
          isLast={index === blocks.length - 1}
          key={block.id}
          onAddAfter={onAddAfter}
          onChangeContent={onChangeContent}
          onChangeType={onChangeType}
          onDelete={onDelete}
          onMove={onMove}
          onToggleTodo={onToggleTodo}
        />
      ))}
    </div>
  );
}
