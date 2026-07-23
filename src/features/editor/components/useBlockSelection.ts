import { useCallback, useEffect, useMemo, useState } from "react";
import type { Block } from "../model/block";
import {
  EMPTY_BLOCK_SELECTION,
  pruneBlockSelection,
  resolveBlockSelection,
  selectBlock,
  type BlockSelectionMode,
  type BlockSelectionState,
} from "../model/blockSelection";

export function useBlockSelection(blocks: Block[]) {
  const [state, setState] = useState<BlockSelectionState>(EMPTY_BLOCK_SELECTION);
  const visibleBlockIds = useMemo(() => blocks.map((block) => block.id), [blocks]);

  useEffect(() => {
    setState((current) => pruneBlockSelection(current, visibleBlockIds));
  }, [visibleBlockIds]);

  const clear = useCallback(() => setState(EMPTY_BLOCK_SELECTION), []);
  const select = useCallback((blockId: string, mode: BlockSelectionMode) => {
    setState((current) => selectBlock(current, blockId, mode, visibleBlockIds));
  }, [visibleBlockIds]);
  const resolved = useMemo(() => resolveBlockSelection(blocks, state), [blocks, state]);

  return { clear, resolved, select, state };
}
