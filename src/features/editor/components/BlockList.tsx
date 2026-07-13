import { useVirtualizer } from "@tanstack/react-virtual";
import type { RefObject } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CollaborationDocument } from "../collaboration/collaborationTypes";
import type { Block, BlockData, BlockStatus, BlockType } from "../model/block";
import { BlockRow } from "./BlockRow";

interface BlockListProps {
  blocks: Block[];
  collaborationDocument: CollaborationDocument | null;
  focusBlockId: string | null;
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
  onFocusedBlock: () => void;
  onIndent: (blockId: string) => void;
  onMove: (blockId: string, direction: "up" | "down") => void;
  onOutdent: (blockId: string) => void;
  onResolveBlockComment: (blockId: string, commentId: string) => void;
  onToggleTodo: (blockId: string) => void;
  scrollElementRef: RefObject<HTMLElement | null>;
}

const VIRTUALIZATION_THRESHOLD = 100;

function estimateBlockSize(block: Block) {
  if (block.type === "table") {
    return 220;
  }
  if (block.type === "kanban") {
    return 280;
  }
  if (block.type === "image") {
    return 300;
  }
  if (block.type === "file") {
    return 76;
  }
  return 48;
}

export function BlockList({
  blocks,
  collaborationDocument,
  focusBlockId,
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
  onFocusedBlock,
  onIndent,
  onMove,
  onOutdent,
  onResolveBlockComment,
  onToggleTodo,
  scrollElementRef,
}: BlockListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const shouldVirtualize = blocks.length >= VIRTUALIZATION_THRESHOLD;
  const blockMeta = useMemo(() => {
    const blocksById = new Map(blocks.map((block) => [block.id, block]));
    const siblingCounts = new Map<string | null, number>();
    const siblingIndexes = new Map<string, number>();

    for (const block of blocks) {
      const siblingIndex = siblingCounts.get(block.parentId) ?? 0;
      siblingIndexes.set(block.id, siblingIndex);
      siblingCounts.set(block.parentId, siblingIndex + 1);
    }

    return new Map(blocks.map((block) => {
      const visited = new Set<string>();
      let depth = 0;
      let parentId = block.parentId;
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = blocksById.get(parentId);
        if (!parent) {
          break;
        }
        depth += 1;
        parentId = parent.parentId;
      }

      const siblingIndex = siblingIndexes.get(block.id) ?? 0;
      return [block.id, {
        depth,
        isFirst: siblingIndex === 0,
        isLast: siblingIndex === (siblingCounts.get(block.parentId) ?? 1) - 1,
      }];
    }));
  }, [blocks]);
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? blocks.length : 0,
    estimateSize: (index) => estimateBlockSize(blocks[index]),
    getItemKey: (index) => blocks[index].id,
    getScrollElement: () => scrollElementRef.current,
    initialRect: { height: 600, width: 1024 },
    overscan: 8,
    scrollMargin,
  });

  useLayoutEffect(() => {
    if (shouldVirtualize && listRef.current) {
      setScrollMargin(listRef.current.offsetTop);
    }
  }, [shouldVirtualize]);

  useLayoutEffect(() => {
    if (!shouldVirtualize || !focusBlockId) {
      return;
    }

    const focusIndex = blocks.findIndex((block) => block.id === focusBlockId);
    const scrollElement = scrollElementRef.current;
    if (focusIndex !== -1 && scrollElement) {
      const offsetBefore = blocks
        .slice(0, focusIndex)
        .reduce((total, block) => total + estimateBlockSize(block), 0);
      const targetSize = estimateBlockSize(blocks[focusIndex]);
      const centeredOffset = offsetBefore + scrollMargin - (scrollElement.clientHeight - targetSize) / 2;
      scrollElement.scrollTo({ behavior: "auto", top: Math.max(centeredOffset, 0) });
    }
  }, [blocks, focusBlockId, scrollElementRef, scrollMargin, shouldVirtualize]);

  const renderBlock = (block: Block, index: number) => {
    const meta = blockMeta.get(block.id) ?? { depth: 0, isFirst: true, isLast: true };
    const previousBlock = blocks[index - 1];

    return <BlockRow
      block={block}
      canIndent={Boolean(previousBlock) && block.parentId !== previousBlock.id}
      canOutdent={block.parentId !== null}
      collaborationDocument={collaborationDocument}
      depth={meta.depth}
      focusRequest={focusBlockId === block.id}
      isFirst={meta.isFirst}
      isLast={meta.isLast}
      isReadOnly={isReadOnly}
      key={block.id}
      onAddAfter={onAddAfter}
      onAddBlockComment={onAddBlockComment}
      onChangeBlockAssignee={onChangeBlockAssignee}
      onChangeBlockDueDate={onChangeBlockDueDate}
      onChangeBlockStatus={onChangeBlockStatus}
      onChangeBlockData={onChangeBlockData}
      onChangeContent={onChangeContent}
      onChangeType={onChangeType}
      onDelete={onDelete}
      onFocused={onFocusedBlock}
      onIndent={onIndent}
      onMove={onMove}
      onOutdent={onOutdent}
      onResolveBlockComment={onResolveBlockComment}
      onToggleTodo={onToggleTodo}
    />;
  };

  if (shouldVirtualize) {
    return (
      <div
        className={`block-list virtual-block-list${isReadOnly ? " block-list-readonly" : ""}`}
        ref={listRef}
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            className="virtual-block-row"
            data-index={virtualRow.index}
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            style={{ transform: `translateY(${virtualRow.start - scrollMargin}px)` }}
          >
            {renderBlock(blocks[virtualRow.index], virtualRow.index)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`block-list${isReadOnly ? " block-list-readonly" : ""}`} ref={listRef}>
      {blocks.map(renderBlock)}
    </div>
  );
}
