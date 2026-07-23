import type { Block, BlockData, BlockStatus, BlockType, EditorDocument, HeadingLevel, MoveDirection } from "./block";
import {
  createRichTextFromPlainText,
  normalizeRichText,
  projectRichTextContent,
  type RichTextUpdate,
} from "../../../shared/richText";

export function createBlockId(now: number) {
  return `block-${now}`;
}

export function createDefaultBlockData(type: BlockType): BlockData | null {
  if (type === "table") {
    return {
      kind: "table",
      columns: [
        { id: "column-1", name: "名称" },
        { id: "column-2", name: "内容" },
      ],
      rows: [
        { id: "row-1", cells: { "column-1": "", "column-2": "" } },
      ],
    };
  }

  if (type === "kanban") {
    return {
      kind: "kanban",
      columns: [
        { id: "column-todo", title: "待处理", cards: [] },
        { id: "column-progress", title: "进行中", cards: [] },
        { id: "column-done", title: "已完成", cards: [] },
      ],
    };
  }

  return null;
}

export function isRichTextBlockType(type: BlockType) {
  return type === "paragraph" || type === "heading" || type === "quote" || type === "todo";
}

export function createBlock(type: BlockType, now: number, content = "", blockId = createBlockId(now)): Block {
  return {
    id: blockId,
    type,
    headingLevel: 1,
    content,
    richText: isRichTextBlockType(type) ? createRichTextFromPlainText(content) : null,
    data: createDefaultBlockData(type),
    checked: false,
    comments: [],
    assignee: "",
    dueDate: "",
    status: "unset",
    parentId: null,
    children: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function touchDocument(document: EditorDocument, blocks: Block[], now: number): EditorDocument {
  // 所有结构性变更都刷新文档时间，UI 保存逻辑只需要观察 document。
  return {
    ...document,
    blocks,
    updatedAt: now,
  };
}

export function insertBlockAfter(
  document: EditorDocument,
  blockId: string,
  now = Date.now(),
  nextBlockId = createBlockId(now),
  type: BlockType = "paragraph",
): EditorDocument {
  const index = document.blocks.findIndex((block) => block.id === blockId);
  const targetBlock = document.blocks[index];
  const nextBlock: Block = {
    ...createBlock(type, now),
    id: nextBlockId,
    parentId: targetBlock?.parentId ?? null,
  };

  if (index === -1) {
    return touchDocument(document, [...document.blocks, nextBlock], now);
  }

  const descendantIds = getDescendantIds(document.blocks, blockId);
  let insertIndex = index + 1;
  while (insertIndex < document.blocks.length && descendantIds.has(document.blocks[insertIndex].id)) {
    insertIndex += 1;
  }

  const blocks = [
    ...document.blocks.slice(0, insertIndex),
    nextBlock,
    ...document.blocks.slice(insertIndex),
  ].map((block) => {
    if (block.id !== nextBlock.parentId) {
      return block;
    }

    const targetChildIndex = block.children.indexOf(blockId);
    const childInsertIndex = targetChildIndex === -1 ? block.children.length : targetChildIndex + 1;
    return {
      ...block,
      children: [
        ...block.children.slice(0, childInsertIndex),
        nextBlock.id,
        ...block.children.slice(childInsertIndex),
      ],
      updatedAt: now,
    };
  });

  return touchDocument(document, blocks, now);
}

function getDescendantIds(blocks: Block[], blockId: string) {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const descendants = new Set<string>();
  const pending = [...(blocksById.get(blockId)?.children ?? [])];

  while (pending.length > 0) {
    const childId = pending.pop();
    if (!childId || descendants.has(childId)) {
      continue;
    }

    descendants.add(childId);
    pending.push(...(blocksById.get(childId)?.children ?? []));
  }

  return descendants;
}

function findLastBlockIndex(blocks: Block[], blockIds: Set<string>) {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blockIds.has(blocks[index].id)) {
      return index;
    }
  }

  return -1;
}

export function indentBlock(
  document: EditorDocument,
  blockId: string,
  now = Date.now(),
): EditorDocument {
  const index = document.blocks.findIndex((block) => block.id === blockId);
  if (index <= 0) {
    return document;
  }

  const block = document.blocks[index];
  const nextParent = document.blocks[index - 1];
  if (block.parentId === nextParent.id || getDescendantIds(document.blocks, blockId).has(nextParent.id)) {
    return document;
  }

  const blocks = document.blocks.map((item) => {
    if (item.id === block.id) {
      return { ...item, parentId: nextParent.id, updatedAt: now };
    }
    if (item.id === block.parentId) {
      return { ...item, children: item.children.filter((childId) => childId !== block.id), updatedAt: now };
    }
    if (item.id === nextParent.id) {
      return {
        ...item,
        children: item.children.includes(block.id) ? item.children : [...item.children, block.id],
        updatedAt: now,
      };
    }
    return item;
  });

  return touchDocument(document, blocks, now);
}

export function outdentBlock(
  document: EditorDocument,
  blockId: string,
  now = Date.now(),
): EditorDocument {
  const block = document.blocks.find((item) => item.id === blockId);
  if (!block?.parentId) {
    return document;
  }

  const parent = document.blocks.find((item) => item.id === block.parentId);
  if (!parent) {
    return document;
  }

  const nextParentId = parent.parentId;
  const blocks = document.blocks.map((item) => {
    if (item.id === block.id) {
      return { ...item, parentId: nextParentId, updatedAt: now };
    }
    if (item.id === parent.id) {
      return { ...item, children: item.children.filter((childId) => childId !== block.id), updatedAt: now };
    }
    if (item.id === nextParentId) {
      const parentIndex = item.children.indexOf(parent.id);
      const insertIndex = parentIndex === -1 ? item.children.length : parentIndex + 1;
      return {
        ...item,
        children: [
          ...item.children.slice(0, insertIndex),
          block.id,
          ...item.children.slice(insertIndex).filter((childId) => childId !== block.id),
        ],
        updatedAt: now,
      };
    }
    return item;
  });

  return touchDocument(document, blocks, now);
}

export function updateBlockContent(
  document: EditorDocument,
  blockId: string,
  content: string,
  now = Date.now(),
): EditorDocument {
  let changed = false;
  const blocks = document.blocks.map((block) => {
    if (block.id !== blockId) {
      return block;
    }

    changed = true;
    return {
      ...block,
      content,
      richText: isRichTextBlockType(block.type) ? createRichTextFromPlainText(content) : null,
      updatedAt: now,
    };
  });

  return changed ? touchDocument(document, blocks, now) : document;
}

export function updateBlockRichText(
  document: EditorDocument,
  blockId: string,
  update: RichTextUpdate,
  now = Date.now(),
): EditorDocument {
  let changed = false;
  const blocks = document.blocks.map((block) => {
    if (block.id !== blockId || !isRichTextBlockType(block.type)) {
      return block;
    }

    const richText = normalizeRichText(update.richText);
    changed = true;
    return {
      ...block,
      content: projectRichTextContent(richText),
      richText,
      updatedAt: now,
    };
  });

  return changed ? touchDocument(document, blocks, now) : document;
}

export function updateDocumentTitle(
  document: EditorDocument,
  title: string,
  now = Date.now(),
): EditorDocument {
  if (document.title === title) {
    return document;
  }

  // 标题保留用户输入的原始值，空标题由展示层统一显示“未命名文档”。
  return {
    ...document,
    title,
    updatedAt: now,
  };
}

export function changeBlockType(
  document: EditorDocument,
  blockId: string,
  type: BlockType,
  now = Date.now(),
  headingLevel: HeadingLevel = 1,
): EditorDocument {
  let changed = false;
  const blocks = document.blocks.map((block) => {
    if (block.id !== blockId) {
      return block;
    }

    changed = true;
    return {
      ...block,
      type,
      headingLevel: type === "heading" ? headingLevel : 1,
      checked: type === "todo" ? block.checked : false,
      data: block.type === type ? block.data : createDefaultBlockData(type),
      richText: isRichTextBlockType(type)
        ? block.richText ?? createRichTextFromPlainText(block.content)
        : null,
      updatedAt: now,
    };
  });

  return changed ? touchDocument(document, blocks, now) : document;
}

export function updateBlockData(
  document: EditorDocument,
  blockId: string,
  data: BlockData | null,
  now = Date.now(),
): EditorDocument {
  return updateBlock(document, blockId, now, (block) => {
    if (data && data.kind !== block.type) {
      return block;
    }

    return {
      ...block,
      data,
      updatedAt: now,
    };
  });
}

export function toggleTodo(
  document: EditorDocument,
  blockId: string,
  now = Date.now(),
): EditorDocument {
  let changed = false;
  const blocks = document.blocks.map((block) => {
    if (block.id !== blockId || block.type !== "todo") {
      return block;
    }

    changed = true;
    return {
      ...block,
      checked: !block.checked,
      updatedAt: now,
    };
  });

  return changed ? touchDocument(document, blocks, now) : document;
}

function updateBlock(
  document: EditorDocument,
  blockId: string,
  now: number,
  update: (block: Block) => Block,
): EditorDocument {
  let changed = false;
  const blocks = document.blocks.map((block) => {
    if (block.id !== blockId) {
      return block;
    }

    changed = true;
    return update(block);
  });

  return changed ? touchDocument(document, blocks, now) : document;
}

export function setBlockAssignee(
  document: EditorDocument,
  blockId: string,
  assignee: string,
  now = Date.now(),
): EditorDocument {
  return updateBlock(document, blockId, now, (block) => ({
    ...block,
    assignee,
    updatedAt: now,
  }));
}

export function setBlockDueDate(
  document: EditorDocument,
  blockId: string,
  dueDate: string,
  now = Date.now(),
): EditorDocument {
  return updateBlock(document, blockId, now, (block) => ({
    ...block,
    dueDate,
    updatedAt: now,
  }));
}

export function setBlockStatus(
  document: EditorDocument,
  blockId: string,
  status: BlockStatus,
  now = Date.now(),
): EditorDocument {
  return updateBlock(document, blockId, now, (block) => ({
    ...block,
    status,
    updatedAt: now,
  }));
}

export function addBlockComment(
  document: EditorDocument,
  blockId: string,
  author: string,
  body: string,
  now = Date.now(),
): EditorDocument {
  const trimmedBody = body.trim();

  if (!trimmedBody) {
    return document;
  }

  return updateBlock(document, blockId, now, (block) => ({
    ...block,
    comments: [
      ...block.comments,
      {
        id: `comment-${now}`,
        author,
        body: trimmedBody,
        time: "刚刚",
        createdAt: now,
        resolved: false,
      },
    ],
    updatedAt: now,
  }));
}

export function resolveBlockComment(
  document: EditorDocument,
  blockId: string,
  commentId: string,
  now = Date.now(),
): EditorDocument {
  return updateBlock(document, blockId, now, (block) => {
    let changed = false;
    const comments = block.comments.map((comment) => {
      if (comment.id !== commentId || comment.resolved) {
        return comment;
      }

      changed = true;
      return {
        ...comment,
        resolved: true,
        resolvedAt: now,
      };
    });

    return changed
      ? {
          ...block,
          comments,
          updatedAt: now,
        }
      : block;
  });
}

export function deleteBlock(
  document: EditorDocument,
  blockId: string,
  now = Date.now(),
): EditorDocument {
  const deletedBlock = document.blocks.find((block) => block.id === blockId);
  if (!deletedBlock) {
    return document;
  }

  const childIds = deletedBlock.children.filter((childId) =>
    document.blocks.some((block) => block.id === childId),
  );
  const blocks = document.blocks
    .filter((block) => block.id !== blockId)
    .map((block) => {
      if (childIds.includes(block.id)) {
        return { ...block, parentId: deletedBlock.parentId, updatedAt: now };
      }
      if (block.id === deletedBlock.parentId) {
        const deletedIndex = block.children.indexOf(blockId);
        const insertIndex = deletedIndex === -1 ? block.children.length : deletedIndex;
        return {
          ...block,
          children: [
            ...block.children.slice(0, insertIndex),
            ...childIds,
            ...block.children.slice(deletedIndex === -1 ? insertIndex : insertIndex + 1),
          ],
          updatedAt: now,
        };
      }
      return block;
    });

  // 编辑器必须始终保留一个可输入块，删除最后一块时立即补一个空段落。
  return touchDocument(document, blocks.length > 0 ? blocks : [createBlock("paragraph", now)], now);
}

export function restoreBlock(
  document: EditorDocument,
  block: Block,
  index: number,
  now = Date.now(),
): EditorDocument {
  if (document.blocks.some((item) => item.id === block.id)) {
    return document;
  }

  const insertIndex = Math.min(Math.max(index, 0), document.blocks.length);
  const restoredChildIds = block.children.filter((childId) =>
    document.blocks.some((item) => item.id === childId),
  );
  const restoredBlock = {
    ...block,
    children: restoredChildIds,
    updatedAt: now,
  };
  const blocks = document.blocks.map((item) => {
    if (restoredChildIds.includes(item.id)) {
      return { ...item, parentId: block.id, updatedAt: now };
    }
    if (item.id !== block.parentId) {
      return item;
    }

    const promotedIndex = item.children.findIndex((childId) => restoredChildIds.includes(childId));
    const insertAt = promotedIndex === -1 ? item.children.length : promotedIndex;
    const remainingChildren = item.children.filter((childId) => !restoredChildIds.includes(childId));
    return {
      ...item,
      children: [
        ...remainingChildren.slice(0, insertAt),
        block.id,
        ...remainingChildren.slice(insertAt),
      ],
      updatedAt: now,
    };
  });

  // 撤销删除时尽量放回原位置，让正文结构保持用户删除前的阅读顺序。
  return touchDocument(
    document,
    [
      ...blocks.slice(0, insertIndex),
      restoredBlock,
      ...blocks.slice(insertIndex),
    ],
    now,
  );
}

export function moveBlock(
  document: EditorDocument,
  blockId: string,
  direction: MoveDirection,
  now = Date.now(),
): EditorDocument {
  const index = document.blocks.findIndex((block) => block.id === blockId);
  if (index === -1) {
    return document;
  }

  const block = document.blocks[index];
  const siblings = document.blocks.filter((item) => item.parentId === block.parentId);
  const siblingIndex = siblings.findIndex((item) => item.id === blockId);
  const targetSiblingIndex = direction === "up" ? siblingIndex - 1 : siblingIndex + 1;
  if (targetSiblingIndex < 0 || targetSiblingIndex >= siblings.length) {
    return document;
  }

  const targetBlock = siblings[targetSiblingIndex];
  const blockIds = new Set([block.id, ...getDescendantIds(document.blocks, block.id)]);
  const targetIds = new Set([targetBlock.id, ...getDescendantIds(document.blocks, targetBlock.id)]);
  const blockStart = document.blocks.findIndex((item) => blockIds.has(item.id));
  const blockEnd = findLastBlockIndex(document.blocks, blockIds);
  const targetStart = document.blocks.findIndex((item) => targetIds.has(item.id));
  const targetEnd = findLastBlockIndex(document.blocks, targetIds);

  let blocks: Block[];
  if (direction === "up") {
    blocks = [
      ...document.blocks.slice(0, targetStart),
      ...document.blocks.slice(blockStart, blockEnd + 1),
      ...document.blocks.slice(targetEnd + 1, blockStart),
      ...document.blocks.slice(targetStart, targetEnd + 1),
      ...document.blocks.slice(blockEnd + 1),
    ];
  } else {
    blocks = [
      ...document.blocks.slice(0, blockStart),
      ...document.blocks.slice(targetStart, targetEnd + 1),
      ...document.blocks.slice(blockEnd + 1, targetStart),
      ...document.blocks.slice(blockStart, blockEnd + 1),
      ...document.blocks.slice(targetEnd + 1),
    ];
  }

  blocks = blocks.map((item) => {
    if (item.id === block.id) {
      return { ...item, updatedAt: now };
    }
    if (item.id === block.parentId) {
      const children = [...item.children];
      const currentIndex = children.indexOf(block.id);
      const nextIndex = children.indexOf(targetBlock.id);
      if (currentIndex !== -1 && nextIndex !== -1) {
        [children[currentIndex], children[nextIndex]] = [children[nextIndex], children[currentIndex]];
      }
      return { ...item, children, updatedAt: now };
    }
    return item;
  });

  return touchDocument(document, blocks, now);
}

export type ReorderPosition = "before" | "after";

export function reorderBlock(
  document: EditorDocument,
  fromId: string,
  toId: string,
  position: ReorderPosition = "before",
  now = Date.now(),
): EditorDocument {
  if (fromId === toId) {
    return document;
  }

  const fromIndex = document.blocks.findIndex((block) => block.id === fromId);
  if (fromIndex === -1) {
    return document;
  }

  const movingBlock = document.blocks[fromIndex];
  const movingIds = new Set([fromId, ...getDescendantIds(document.blocks, fromId)]);

  // 不允许把块拖入其自身子树内。
  if (movingIds.has(toId)) {
    return document;
  }

  const withoutMoving = document.blocks.filter((block) => !movingIds.has(block.id));
  const toIndex = withoutMoving.findIndex((block) => block.id === toId);
  if (toIndex === -1) {
    return document;
  }

  const insertIndex = position === "before" ? toIndex : toIndex + 1;
  const movingSubtree = document.blocks.filter((block) => movingIds.has(block.id));
  const blocks = [
    ...withoutMoving.slice(0, insertIndex),
    ...movingSubtree,
    ...withoutMoving.slice(insertIndex),
  ].map((block) => {
    if (movingIds.has(block.id)) {
      return { ...block, parentId: movingBlock.parentId, updatedAt: now };
    }
    return block;
  });

  return touchDocument(document, blocks, now);
}
