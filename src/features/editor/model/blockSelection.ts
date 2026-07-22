import type { Block } from "./block";

export interface BlockSelectionState {
  anchorBlockId: string | null;
  selectedBlockIds: string[];
}

export interface ResolvedBlockSelection {
  orderedBlockIds: string[];
  rootBlockIds: string[];
}

export type BlockSelectionMode = "replace" | "toggle" | "range";

export const EMPTY_BLOCK_SELECTION: BlockSelectionState = {
  anchorBlockId: null,
  selectedBlockIds: [],
};

export function resolveBlockSelection(
  blocks: Block[],
  state: BlockSelectionState,
): ResolvedBlockSelection {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const selectedIds = new Set(state.selectedBlockIds.filter((id) => blocksById.has(id)));
  const descendantIds = expandSelectedDescendants(blocks, blocksById, selectedIds);

  const orderedBlockIds = blocks
    .filter((block) => selectedIds.has(block.id))
    .map((block) => block.id);
  const rootBlockIds = orderedBlockIds.filter(
    (blockId) =>
      !descendantIds.has(blockId) && !hasSelectedAncestor(blockId, selectedIds, blocksById),
  );

  return { orderedBlockIds, rootBlockIds };
}

function expandSelectedDescendants(
  blocks: Block[],
  blocksById: Map<string, Block>,
  selectedIds: Set<string>,
): Set<string> {
  const descendantIds = new Set<string>();
  const selectedRootIds = blocks
    .map((block) => block.id)
    .filter((blockId) => selectedIds.has(blockId));

  for (const rootId of selectedRootIds) {
    if (descendantIds.has(rootId)) {
      continue;
    }

    const visitedIds = new Set([rootId]);
    const pendingIds = [rootId];

    while (pendingIds.length > 0) {
      const blockId = pendingIds.pop()!;
      for (const childId of blocksById.get(blockId)?.children ?? []) {
        if (!blocksById.has(childId) || visitedIds.has(childId)) {
          continue;
        }

        visitedIds.add(childId);
        descendantIds.add(childId);
        selectedIds.add(childId);
        pendingIds.push(childId);
      }
    }
  }

  return descendantIds;
}

export function selectBlock(
  state: BlockSelectionState,
  blockId: string,
  mode: BlockSelectionMode,
  visibleBlockIds: string[] = [],
): BlockSelectionState {
  if (mode === "replace") {
    return {
      anchorBlockId: blockId,
      selectedBlockIds: [blockId],
    };
  }

  if (mode === "toggle") {
    const selectedBlockIds = uniqueIds(state.selectedBlockIds);
    const existingIndex = selectedBlockIds.indexOf(blockId);
    const nextSelectedBlockIds =
      existingIndex === -1
        ? [...selectedBlockIds, blockId]
        : selectedBlockIds.filter((selectedId) => selectedId !== blockId);

    return nextSelectedBlockIds.length === 0
      ? EMPTY_BLOCK_SELECTION
      : {
          anchorBlockId: blockId,
          selectedBlockIds: nextSelectedBlockIds,
        };
  }

  const anchorBlockId = state.anchorBlockId ?? blockId;
  const anchorIndex = visibleBlockIds.indexOf(anchorBlockId);
  const targetIndex = visibleBlockIds.indexOf(blockId);

  if (anchorIndex === -1 || targetIndex === -1) {
    return {
      anchorBlockId: blockId,
      selectedBlockIds: [blockId],
    };
  }

  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return {
    anchorBlockId,
    selectedBlockIds: uniqueIds(visibleBlockIds.slice(start, end + 1)),
  };
}

export function pruneBlockSelection(
  state: BlockSelectionState,
  availableBlockIds: string[],
): BlockSelectionState {
  const availableIds = new Set(availableBlockIds);
  const selectedBlockIds = uniqueIds(state.selectedBlockIds).filter((id) => availableIds.has(id));

  if (selectedBlockIds.length === 0) {
    return EMPTY_BLOCK_SELECTION;
  }

  return {
    anchorBlockId:
      state.anchorBlockId && availableIds.has(state.anchorBlockId) ? state.anchorBlockId : null,
    selectedBlockIds,
  };
}

function hasSelectedAncestor(
  blockId: string,
  selectedIds: Set<string>,
  blocksById: Map<string, Block>,
): boolean {
  const visitedIds = new Set([blockId]);
  let parentId = blocksById.get(blockId)?.parentId ?? null;

  while (parentId && !visitedIds.has(parentId)) {
    if (selectedIds.has(parentId)) {
      return true;
    }

    visitedIds.add(parentId);
    parentId = blocksById.get(parentId)?.parentId ?? null;
  }

  return false;
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}
