import {
  createBlock,
  createDefaultBlockData,
  isRichTextBlockType,
  touchDocument,
} from "./documentBlockOperations";
import type { Block, BlockType, EditorDocument, HeadingLevel } from "./block";
import { resolveBlockSelection } from "./blockSelection";
import {
  createRichTextFromPlainText,
  normalizeRichText,
  projectRichTextContent,
  type RichTextDocument,
  type RichTextInlineNode,
} from "../../../shared/richText";

export interface BatchBlockMutationResult {
  affectedBlockIds: string[];
  document: EditorDocument;
  error?: string;
  focusBlockId: string | null;
}

export type BatchBlockMovePosition = "before" | "after";
export type BatchBlockTextMark = "bold" | "italic" | "strike" | "code";

export interface DuplicateBlockRootsOptions {
  nextId?: () => string;
  now?: number;
}

const ERROR_EMPTY_SELECTION = "\u672a\u627e\u5230\u53ef\u64cd\u4f5c\u7684\u5757";
const ERROR_INVALID_TARGET = "\u79fb\u52a8\u76ee\u6807\u65e0\u6548";
const ERROR_INVALID_POSITION = "\u79fb\u52a8\u4f4d\u7f6e\u65e0\u6548";
const ERROR_TARGET_IN_SUBTREE = "\u4e0d\u80fd\u79fb\u52a8\u5230\u6240\u9009\u5757\u7684\u5b50\u6811\u4e2d";
const ERROR_DIFFERENT_LEVELS = "\u6240\u9009\u5757\u5fc5\u987b\u5904\u4e8e\u540c\u4e00\u5c42\u7ea7";
const ERROR_INVALID_HIERARCHY = "\u5757\u5c42\u7ea7\u5173\u7cfb\u65e0\u6548";
const ERROR_NO_PREVIOUS_SIBLING = "\u6ca1\u6709\u53ef\u7528\u7684\u524d\u7f6e\u540c\u7ea7\u5757";
const ERROR_CANNOT_OUTDENT = "\u65e0\u6cd5\u51cf\u5c11\u6240\u9009\u5757\u7684\u7f29\u8fdb";
const ERROR_UNSUPPORTED_TYPE = "\u4e0d\u652f\u6301\u7684\u6279\u91cf\u5757\u7c7b\u578b";
const ERROR_UNSUPPORTED_MARK = "\u4e0d\u652f\u6301\u7684\u6587\u672c\u683c\u5f0f";
const ERROR_INVALID_RICH_TEXT = "\u5bcc\u6587\u672c\u7ed3\u6784\u65e0\u6548";
const ERROR_DUPLICATE_ID = "\u590d\u5236\u5757 ID \u65e0\u6548";

const BATCH_BLOCK_TYPES = new Set<BlockType>(["paragraph", "heading", "quote", "todo", "code"]);
const BATCH_TEXT_MARKS = new Set<BatchBlockTextMark>(["bold", "italic", "strike", "code"]);

interface ResolvedRoots {
  orderedBlockIds: string[];
  rootBlockIds: string[];
}

function unchanged(document: EditorDocument, error?: string): BatchBlockMutationResult {
  return {
    affectedBlockIds: [],
    document,
    ...(error ? { error } : {}),
    focusBlockId: null,
  };
}

function resolveRoots(document: EditorDocument, requestedBlockIds: string[]): ResolvedRoots | null {
  const blocksById = new Map(document.blocks.map((block) => [block.id, block]));
  if (
    requestedBlockIds.length === 0 ||
    requestedBlockIds.some((blockId) => !blocksById.has(blockId))
  ) {
    return null;
  }

  const resolved = resolveBlockSelection(document.blocks, {
    anchorBlockId: null,
    selectedBlockIds: requestedBlockIds,
  });

  return resolved.rootBlockIds.length > 0 ? resolved : null;
}

function collectSubtreeIds(blocks: Block[], rootBlockIds: string[]): Set<string> {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const subtreeIds = new Set<string>();
  const pendingIds = [...rootBlockIds];

  while (pendingIds.length > 0) {
    const blockId = pendingIds.pop()!;
    if (subtreeIds.has(blockId) || !blocksById.has(blockId)) {
      continue;
    }

    subtreeIds.add(blockId);
    pendingIds.push(...(blocksById.get(blockId)?.children ?? []));
  }

  return subtreeIds;
}

function updateBlockAt(block: Block, now: number, updates: Partial<Block>): Block {
  return { ...block, ...updates, updatedAt: now };
}

function applyBlockUpdates(blocks: Block[], updates: Map<string, Block>): Block[] {
  return blocks.map((block) => updates.get(block.id) ?? block);
}

function sameIds(left: Block[], right: Block[]) {
  return left.length === right.length && left.every((block, index) => block.id === right[index]?.id);
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function siblingsForParent(blocks: Block[], parentId: string | null): string[] | null {
  if (parentId === null) {
    return blocks.filter((block) => block.parentId === null).map((block) => block.id);
  }

  const parent = blocks.find((block) => block.id === parentId);
  return parent ? [...parent.children] : null;
}

function validateCommonParent(blocks: Block[], rootBlockIds: string[]): string | null | undefined {
  const roots = rootBlockIds.map((blockId) => blocks.find((block) => block.id === blockId));
  if (roots.some((block) => !block)) {
    return undefined;
  }

  const parentId = roots[0]!.parentId;
  if (roots.some((block) => block!.parentId !== parentId)) {
    return undefined;
  }

  const siblingIds = siblingsForParent(blocks, parentId);
  if (!siblingIds || rootBlockIds.some((blockId) => !siblingIds.includes(blockId))) {
    return undefined;
  }

  return parentId;
}

function insertIdsAfter(ids: string[], anchorId: string, insertedIds: string[]): string[] {
  const anchorIndex = ids.indexOf(anchorId);
  return anchorIndex === -1
    ? ids
    : [...ids.slice(0, anchorIndex + 1), ...insertedIds, ...ids.slice(anchorIndex + 1)];
}

function moveSubtrees(
  blocks: Block[],
  movingIds: Set<string>,
  targetId: string,
  position: BatchBlockMovePosition,
): Block[] {
  const movingBlocks = blocks.filter((block) => movingIds.has(block.id));
  const remainingBlocks = blocks.filter((block) => !movingIds.has(block.id));
  const targetIndex = remainingBlocks.findIndex((block) => block.id === targetId);
  if (targetIndex === -1) {
    return blocks;
  }

  const targetSubtreeIds = collectSubtreeIds(remainingBlocks, [targetId]);
  const targetSubtreeEnd = remainingBlocks.reduce(
    (lastIndex, block, index) => targetSubtreeIds.has(block.id) ? index : lastIndex,
    targetIndex,
  );
  const insertIndex = position === "before" ? targetIndex : targetSubtreeEnd + 1;

  return [
    ...remainingBlocks.slice(0, insertIndex),
    ...movingBlocks,
    ...remainingBlocks.slice(insertIndex),
  ];
}

function moveSubtreesAfterAnchor(blocks: Block[], movingIds: Set<string>, anchorId: string): Block[] {
  return moveSubtrees(blocks, movingIds, anchorId, "after");
}

function hasCompleteAncestorChain(blocks: Block[], block: Block): boolean {
  const blocksById = new Map(blocks.map((item) => [item.id, item]));
  const visitedIds = new Set<string>();
  let current: Block | undefined = block;

  while (current?.parentId) {
    if (visitedIds.has(current.id)) {
      return false;
    }
    visitedIds.add(current.id);

    const parent = blocksById.get(current.parentId);
    if (!parent || !parent.children.includes(current.id)) {
      return false;
    }
    current = parent;
  }

  return Boolean(current);
}

export function deleteBlocks(
  document: EditorDocument,
  requestedBlockIds: string[],
  now = Date.now(),
): BatchBlockMutationResult {
  const resolved = resolveRoots(document, requestedBlockIds);
  if (!resolved) {
    return unchanged(document, ERROR_EMPTY_SELECTION);
  }

  const deletedIds = collectSubtreeIds(document.blocks, resolved.rootBlockIds);
  const firstDeletedIndex = document.blocks.findIndex((block) => deletedIds.has(block.id));
  const remainingBlocks = document.blocks.filter((block) => !deletedIds.has(block.id));
  const updates = new Map<string, Block>();

  for (const block of remainingBlocks) {
    const children = block.children.filter((childId) => !deletedIds.has(childId));
    if (!sameStringArray(children, block.children)) {
      updates.set(block.id, updateBlockAt(block, now, { children }));
    }
  }

  const blocks = applyBlockUpdates(remainingBlocks, updates);
  if (blocks.length === 0) {
    const fallback = createBlock("paragraph", now);
    return {
      affectedBlockIds: document.blocks.filter((block) => deletedIds.has(block.id)).map((block) => block.id),
      document: touchDocument(document, [fallback], now),
      focusBlockId: fallback.id,
    };
  }

  const focusBlock = blocks.find((_, index) => index >= firstDeletedIndex) ?? blocks.at(-1)!;
  return {
    affectedBlockIds: document.blocks.filter((block) => deletedIds.has(block.id)).map((block) => block.id),
    document: touchDocument(document, blocks, now),
    focusBlockId: focusBlock.id,
  };
}

export function moveBlockRoots(
  document: EditorDocument,
  requestedBlockIds: string[],
  targetBlockId: string,
  position: BatchBlockMovePosition,
  now = Date.now(),
): BatchBlockMutationResult {
  if (position !== "before" && position !== "after") {
    return unchanged(document, ERROR_INVALID_POSITION);
  }

  const resolved = resolveRoots(document, requestedBlockIds);
  if (!resolved) {
    return unchanged(document, ERROR_EMPTY_SELECTION);
  }

  const parentId = validateCommonParent(document.blocks, resolved.rootBlockIds);
  const target = document.blocks.find((block) => block.id === targetBlockId);
  if (!target) {
    return unchanged(document, ERROR_INVALID_TARGET);
  }

  const movingIds = collectSubtreeIds(document.blocks, resolved.rootBlockIds);
  if (movingIds.has(targetBlockId)) {
    return unchanged(
      document,
      resolved.rootBlockIds.includes(targetBlockId) ? ERROR_INVALID_TARGET : ERROR_TARGET_IN_SUBTREE,
    );
  }
  if (parentId === undefined || target.parentId !== parentId) {
    return unchanged(document, ERROR_INVALID_TARGET);
  }

  const siblingIds = siblingsForParent(document.blocks, parentId);
  if (!siblingIds || !siblingIds.includes(targetBlockId)) {
    return unchanged(document, ERROR_INVALID_TARGET);
  }
  const withoutRoots = siblingIds.filter((blockId) => !resolved.rootBlockIds.includes(blockId));
  const targetIndex = withoutRoots.indexOf(targetBlockId);
  const nextSiblingIds = position === "before"
    ? [...withoutRoots.slice(0, targetIndex), ...resolved.rootBlockIds, ...withoutRoots.slice(targetIndex)]
    : [...withoutRoots.slice(0, targetIndex + 1), ...resolved.rootBlockIds, ...withoutRoots.slice(targetIndex + 1)];
  const nextBlocks = moveSubtrees(document.blocks, movingIds, targetBlockId, position);
  if (sameIds(nextBlocks, document.blocks) && sameStringArray(nextSiblingIds, siblingIds)) {
    return unchanged(document);
  }

  const updates = new Map<string, Block>();
  for (const blockId of resolved.rootBlockIds) {
    const block = document.blocks.find((item) => item.id === blockId)!;
    updates.set(blockId, updateBlockAt(block, now, {}));
  }
  if (parentId) {
    const parent = document.blocks.find((block) => block.id === parentId)!;
    updates.set(parentId, updateBlockAt(parent, now, { children: nextSiblingIds }));
  }

  return {
    affectedBlockIds: resolved.rootBlockIds,
    document: touchDocument(document, applyBlockUpdates(nextBlocks, updates), now),
    focusBlockId: resolved.rootBlockIds[0],
  };
}

export function indentBlockRoots(
  document: EditorDocument,
  requestedBlockIds: string[],
  now = Date.now(),
): BatchBlockMutationResult {
  const resolved = resolveRoots(document, requestedBlockIds);
  if (!resolved) {
    return unchanged(document, ERROR_EMPTY_SELECTION);
  }

  const parentId = validateCommonParent(document.blocks, resolved.rootBlockIds);
  const siblingIds = parentId === undefined ? null : siblingsForParent(document.blocks, parentId);
  if (parentId === undefined || !siblingIds) {
    return unchanged(document, ERROR_DIFFERENT_LEVELS);
  }

  const firstRootIndex = siblingIds.indexOf(resolved.rootBlockIds[0]);
  const newParentId = siblingIds[firstRootIndex - 1];
  if (!newParentId || resolved.rootBlockIds.includes(newParentId)) {
    return unchanged(document, ERROR_NO_PREVIOUS_SIBLING);
  }

  const newParent = document.blocks.find((block) => block.id === newParentId);
  const oldParent = parentId ? document.blocks.find((block) => block.id === parentId) : null;
  const movingIds = collectSubtreeIds(document.blocks, resolved.rootBlockIds);
  const newParentSubtreeIds = collectSubtreeIds(document.blocks, [newParentId]);
  if (
    !newParent ||
    resolved.rootBlockIds.some((blockId) => newParent.children.includes(blockId)) ||
    resolved.rootBlockIds.some((blockId) => newParentSubtreeIds.has(blockId))
  ) {
    return unchanged(document, ERROR_INVALID_HIERARCHY);
  }
  if (parentId && !oldParent) {
    return unchanged(document, ERROR_INVALID_HIERARCHY);
  }

  const updates = new Map<string, Block>();
  for (const blockId of resolved.rootBlockIds) {
    const block = document.blocks.find((item) => item.id === blockId)!;
    updates.set(blockId, updateBlockAt(block, now, { parentId: newParentId }));
  }
  if (oldParent) {
    updates.set(
      oldParent.id,
      updateBlockAt(oldParent, now, {
        children: oldParent.children.filter((childId) => !resolved.rootBlockIds.includes(childId)),
      }),
    );
  }
  updates.set(
    newParentId,
    updateBlockAt(newParent, now, { children: [...newParent.children, ...resolved.rootBlockIds] }),
  );

  return {
    affectedBlockIds: resolved.rootBlockIds,
    document: touchDocument(
      document,
      applyBlockUpdates(moveSubtreesAfterAnchor(document.blocks, movingIds, newParentId), updates),
      now,
    ),
    focusBlockId: resolved.rootBlockIds[0],
  };
}

export function outdentBlockRoots(
  document: EditorDocument,
  requestedBlockIds: string[],
  now = Date.now(),
): BatchBlockMutationResult {
  const resolved = resolveRoots(document, requestedBlockIds);
  if (!resolved) {
    return unchanged(document, ERROR_EMPTY_SELECTION);
  }

  const parentId = validateCommonParent(document.blocks, resolved.rootBlockIds);
  if (!parentId) {
    return unchanged(document, ERROR_CANNOT_OUTDENT);
  }

  const parent = document.blocks.find((block) => block.id === parentId);
  if (!parent || !hasCompleteAncestorChain(document.blocks, parent)) {
    return unchanged(document, ERROR_INVALID_HIERARCHY);
  }

  const grandParentId = parent.parentId;
  const grandParent = grandParentId
    ? document.blocks.find((block) => block.id === grandParentId)
    : null;
  if (grandParentId && (!grandParent || !grandParent.children.includes(parent.id))) {
    return unchanged(document, ERROR_INVALID_HIERARCHY);
  }
  if (grandParent?.children.some((childId) => resolved.rootBlockIds.includes(childId))) {
    return unchanged(document, ERROR_INVALID_HIERARCHY);
  }

  const updates = new Map<string, Block>();
  for (const blockId of resolved.rootBlockIds) {
    const block = document.blocks.find((item) => item.id === blockId)!;
    updates.set(blockId, updateBlockAt(block, now, { parentId: grandParentId }));
  }
  updates.set(
    parent.id,
    updateBlockAt(parent, now, {
      children: parent.children.filter((childId) => !resolved.rootBlockIds.includes(childId)),
    }),
  );
  if (grandParent) {
    updates.set(
      grandParent.id,
      updateBlockAt(grandParent, now, {
        children: insertIdsAfter(grandParent.children, parent.id, resolved.rootBlockIds),
      }),
    );
  }

  return {
    affectedBlockIds: resolved.rootBlockIds,
    document: touchDocument(
      document,
      applyBlockUpdates(
        moveSubtreesAfterAnchor(
          document.blocks,
          collectSubtreeIds(document.blocks, resolved.rootBlockIds),
          parent.id,
        ),
        updates,
      ),
      now,
    ),
    focusBlockId: resolved.rootBlockIds[0],
  };
}

export function changeBlockTypes(
  document: EditorDocument,
  requestedBlockIds: string[],
  type: BlockType,
  now = Date.now(),
  headingLevel: HeadingLevel = 1,
): BatchBlockMutationResult {
  if (!BATCH_BLOCK_TYPES.has(type)) {
    return unchanged(document, ERROR_UNSUPPORTED_TYPE);
  }

  const resolved = resolveRoots(document, requestedBlockIds);
  if (!resolved) {
    return unchanged(document, ERROR_EMPTY_SELECTION);
  }

  const updates = new Map<string, Block>();
  try {
    for (const blockId of resolved.orderedBlockIds) {
      const block = document.blocks.find((item) => item.id === blockId)!;
      const richText = isRichTextBlockType(type)
        ? normalizeRichText(block.richText ?? createRichTextFromPlainText(block.content))
        : null;
      const nextBlock = {
        ...block,
        type,
        headingLevel: type === "heading" ? headingLevel : 1,
        checked: type === "todo" ? block.checked : false,
        data: createDefaultBlockData(type),
        richText,
      };
      if (JSON.stringify(nextBlock) !== JSON.stringify(block)) {
        updates.set(blockId, updateBlockAt(block, now, nextBlock));
      }
    }
  } catch {
    return unchanged(document, ERROR_INVALID_RICH_TEXT);
  }

  if (updates.size === 0) {
    return unchanged(document);
  }

  return {
    affectedBlockIds: resolved.orderedBlockIds.filter((blockId) => updates.has(blockId)),
    document: touchDocument(document, applyBlockUpdates(document.blocks, updates), now),
    focusBlockId: resolved.rootBlockIds[0],
  };
}

function textNodes(document: RichTextDocument): Extract<RichTextInlineNode, { type: "text" }>[] {
  return (document.content[0].content ?? []).filter(
    (node): node is Extract<RichTextInlineNode, { type: "text" }> => node.type === "text",
  );
}

function textNodeHasMark(
  node: Extract<RichTextInlineNode, { type: "text" }>,
  mark: BatchBlockTextMark,
): boolean {
  return node.marks?.some((item) => item.type === mark) ?? false;
}

function withToggledMark(
  document: RichTextDocument,
  mark: BatchBlockTextMark,
  addMark: boolean,
): RichTextDocument {
  const content = document.content[0].content?.map((node) => {
    if (node.type !== "text") {
      return structuredClone(node);
    }

    const marks = addMark
      ? textNodeHasMark(node, mark) ? node.marks ?? [] : [...(node.marks ?? []), { type: mark }]
      : (node.marks ?? []).filter((item) => item.type !== mark);
    return {
      ...(marks.length > 0 ? { marks } : {}),
      text: node.text,
      type: "text" as const,
    };
  });

  return normalizeRichText({
    content: [{ ...(content && content.length > 0 ? { content } : {}), type: "paragraph" }],
    type: "doc",
  });
}

export function toggleMarkForBlocks(
  document: EditorDocument,
  requestedBlockIds: string[],
  mark: BatchBlockTextMark,
  now = Date.now(),
): BatchBlockMutationResult {
  if (!BATCH_TEXT_MARKS.has(mark)) {
    return unchanged(document, ERROR_UNSUPPORTED_MARK);
  }

  const resolved = resolveRoots(document, requestedBlockIds);
  if (!resolved) {
    return unchanged(document, ERROR_EMPTY_SELECTION);
  }

  const richTextBlocks = resolved.orderedBlockIds
    .map((blockId) => document.blocks.find((block) => block.id === blockId)!)
    .filter((block) => isRichTextBlockType(block.type));
  const normalizedDocuments = new Map<string, RichTextDocument>();

  try {
    for (const block of richTextBlocks) {
      normalizedDocuments.set(
        block.id,
        normalizeRichText(block.richText ?? createRichTextFromPlainText(block.content)),
      );
    }
  } catch {
    return unchanged(document, ERROR_INVALID_RICH_TEXT);
  }

  const allTextNodes = [...normalizedDocuments.values()].flatMap(textNodes);
  if (allTextNodes.length === 0) {
    return unchanged(document);
  }
  const addMark = !allTextNodes.every((node) => textNodeHasMark(node, mark));
  const updates = new Map<string, Block>();

  for (const block of richTextBlocks) {
    const richText = withToggledMark(normalizedDocuments.get(block.id)!, mark, addMark);
    const content = projectRichTextContent(richText);
    if (JSON.stringify(richText) !== JSON.stringify(block.richText) || content !== block.content) {
      updates.set(block.id, updateBlockAt(block, now, { content, richText }));
    }
  }

  if (updates.size === 0) {
    return unchanged(document);
  }

  return {
    affectedBlockIds: richTextBlocks.map((block) => block.id).filter((blockId) => updates.has(blockId)),
    document: touchDocument(document, applyBlockUpdates(document.blocks, updates), now),
    focusBlockId: resolved.rootBlockIds[0],
  };
}

export function duplicateBlockRoots(
  document: EditorDocument,
  requestedBlockIds: string[],
  options: DuplicateBlockRootsOptions = {},
): BatchBlockMutationResult {
  const resolved = resolveRoots(document, requestedBlockIds);
  if (!resolved) {
    return unchanged(document, ERROR_EMPTY_SELECTION);
  }

  const parentId = validateCommonParent(document.blocks, resolved.rootBlockIds);
  if (parentId === undefined) {
    return unchanged(document, ERROR_DIFFERENT_LEVELS);
  }

  const now = options.now ?? Date.now();
  const sourceIds = collectSubtreeIds(document.blocks, resolved.rootBlockIds);
  const sourceBlocks = document.blocks.filter((block) => sourceIds.has(block.id));
  const existingIds = new Set(document.blocks.map((block) => block.id));
  const idMap = new Map<string, string>();

  try {
    for (const [index, source] of sourceBlocks.entries()) {
      const copiedId = options.nextId ? options.nextId() : `block-${now}-copy-${index + 1}`;
      if (!copiedId || existingIds.has(copiedId) || [...idMap.values()].includes(copiedId)) {
        return unchanged(document, ERROR_DUPLICATE_ID);
      }
      idMap.set(source.id, copiedId);
    }
  } catch {
    return unchanged(document, ERROR_DUPLICATE_ID);
  }

  const rootIds = new Set(resolved.rootBlockIds);
  const copiedBlocks = sourceBlocks.map((source) => {
    const copiedId = idMap.get(source.id)!;
    return {
      ...source,
      id: copiedId,
      richText: source.richText ? structuredClone(source.richText) : null,
      data: source.data ? structuredClone(source.data) : null,
      comments: [],
      parentId: rootIds.has(source.id) ? source.parentId : idMap.get(source.parentId ?? "") ?? null,
      children: source.children.flatMap((childId) => {
        const copiedChildId = idMap.get(childId);
        return copiedChildId ? [copiedChildId] : [];
      }),
      createdAt: now,
      updatedAt: now,
    };
  });
  const copiedRootIds = resolved.rootBlockIds.map((blockId) => idMap.get(blockId)!);
  const lastRootId = resolved.rootBlockIds.at(-1)!;
  const lastRootSubtreeIds = collectSubtreeIds(document.blocks, [lastRootId]);
  const lastRootSubtreeIndex = document.blocks.reduce(
    (lastIndex, block, index) => lastRootSubtreeIds.has(block.id) ? index : lastIndex,
    document.blocks.findIndex((block) => block.id === lastRootId),
  );
  const blocks = [
    ...document.blocks.slice(0, lastRootSubtreeIndex + 1),
    ...copiedBlocks,
    ...document.blocks.slice(lastRootSubtreeIndex + 1),
  ];
  const updates = new Map<string, Block>();
  if (parentId) {
    const parent = document.blocks.find((block) => block.id === parentId)!;
    updates.set(
      parentId,
      updateBlockAt(parent, now, {
        children: insertIdsAfter(parent.children, lastRootId, copiedRootIds),
      }),
    );
  }

  return {
    affectedBlockIds: copiedBlocks.map((block) => block.id),
    document: touchDocument(document, applyBlockUpdates(blocks, updates), now),
    focusBlockId: copiedRootIds[0],
  };
}
