import type { Block, BlockType, EditorDocument, MoveDirection } from "./block";

export const DEFAULT_DOCUMENT_ID = "local-document";

function createBlock(type: BlockType, now: number, content = ""): Block {
  return {
    id: `block-${now}`,
    type,
    content,
    checked: false,
    parentId: null,
    children: [],
    createdAt: now,
    updatedAt: now,
  };
}

function touchDocument(document: EditorDocument, blocks: Block[], now: number): EditorDocument {
  // 所有结构性变更都刷新文档时间，UI 保存逻辑只需要观察 document。
  return {
    ...document,
    blocks,
    updatedAt: now,
  };
}

export function createDefaultDocument(now = Date.now()): EditorDocument {
  return {
    id: DEFAULT_DOCUMENT_ID,
    title: "Untitled",
    blocks: [createBlock("paragraph", now)],
    updatedAt: now,
  };
}

export function insertBlockAfter(
  document: EditorDocument,
  blockId: string,
  now = Date.now(),
): EditorDocument {
  const index = document.blocks.findIndex((block) => block.id === blockId);
  const nextBlock = createBlock("paragraph", now);

  if (index === -1) {
    return touchDocument(document, [...document.blocks, nextBlock], now);
  }

  return touchDocument(
    document,
    [...document.blocks.slice(0, index + 1), nextBlock, ...document.blocks.slice(index + 1)],
    now,
  );
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
      updatedAt: now,
    };
  });

  return changed ? touchDocument(document, blocks, now) : document;
}

export function changeBlockType(
  document: EditorDocument,
  blockId: string,
  type: BlockType,
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
      type,
      checked: type === "todo" ? block.checked : false,
      updatedAt: now,
    };
  });

  return changed ? touchDocument(document, blocks, now) : document;
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

export function deleteBlock(
  document: EditorDocument,
  blockId: string,
  now = Date.now(),
): EditorDocument {
  const blocks = document.blocks.filter((block) => block.id !== blockId);

  if (blocks.length === document.blocks.length) {
    return document;
  }

  // 编辑器必须始终保留一个可输入块，删除最后一块时立即补一个空段落。
  return touchDocument(document, blocks.length > 0 ? blocks : [createBlock("paragraph", now)], now);
}

export function moveBlock(
  document: EditorDocument,
  blockId: string,
  direction: MoveDirection,
  now = Date.now(),
): EditorDocument {
  const index = document.blocks.findIndex((block) => block.id === blockId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;

  if (index === -1 || targetIndex < 0 || targetIndex >= document.blocks.length) {
    return document;
  }

  const blocks = [...document.blocks];
  const [block] = blocks.splice(index, 1);
  blocks.splice(targetIndex, 0, block);

  return touchDocument(document, blocks, now);
}
