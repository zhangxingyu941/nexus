import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useMemo, useState, type ReactNode } from "react";
import type { Block } from "../model/block";

export type BlockDropPosition = "before" | "after";

interface BlockDndContextProps {
  blocks: Block[];
  children: ReactNode;
  disabled?: boolean;
  onDrop: (rootBlockIds: string[], targetBlockId: string, position: BlockDropPosition) => void;
  selectedRootIds: string[];
}

function isTargetInsideRoots(blocks: Block[], rootBlockIds: string[], targetBlockId: string) {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const roots = new Set(rootBlockIds);
  let current = blocksById.get(targetBlockId);

  while (current) {
    if (roots.has(current.id)) {
      return true;
    }
    current = current.parentId ? blocksById.get(current.parentId) : undefined;
  }

  return false;
}

function resolveDraggedRootIds(blocks: Block[], selectedRootIds: string[], activeBlockId: string) {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const roots = selectedRootIds.filter((id) => blocksById.has(id));
  let current = blocksById.get(activeBlockId);

  while (current) {
    if (roots.includes(current.id)) {
      return roots;
    }
    current = current.parentId ? blocksById.get(current.parentId) : undefined;
  }

  return blocksById.has(activeBlockId) ? [activeBlockId] : [];
}

export function BlockDndContext({
  blocks,
  children,
  disabled = false,
  onDrop,
  selectedRootIds,
}: BlockDndContextProps) {
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const blockIds = useMemo(() => blocks.map((block) => block.id), [blocks]);
  const blocksById = useMemo(() => new Map(blocks.map((block) => [block.id, block])), [blocks]);
  const activeBlock = activeBlockId ? blocksById.get(activeBlockId) : null;
  const activeRootIds = activeBlockId
    ? resolveDraggedRootIds(blocks, selectedRootIds, activeBlockId)
    : [];

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveBlockId(String(active.id));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveBlockId(null);
    if (!over) {
      return;
    }

    const activeId = String(active.id);
    const targetId = String(over.id);
    const rootBlockIds = resolveDraggedRootIds(blocks, selectedRootIds, activeId);
    if (rootBlockIds.length === 0 || isTargetInsideRoots(blocks, rootBlockIds, targetId)) {
      return;
    }

    const activeIndex = blockIds.indexOf(activeId);
    const targetIndex = blockIds.indexOf(targetId);
    if (activeIndex === -1 || targetIndex === -1) {
      return;
    }

    onDrop(rootBlockIds, targetId, activeIndex < targetIndex ? "after" : "before");
  };

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragCancel={() => setActiveBlockId(null)}
      onDragEnd={handleDragEnd}
      onDragStart={handleDragStart}
      sensors={disabled ? undefined : sensors}
    >
      <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeBlock ? (
          <div className="block-drag-overlay">
            <span>{activeBlock.content.trim() || "空白块"}</span>
            {activeRootIds.length > 1 ? <span>{activeRootIds.length} 个块</span> : null}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
