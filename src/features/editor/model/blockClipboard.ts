import {
  createRichTextFromPlainText,
  normalizeRichText,
  normalizeRichTextLink,
  type RichTextDocument,
} from "../../../shared/richText";
import { isRichTextBlockType } from "./documentBlockOperations";
import { resolveBlockSelection } from "./blockSelection";
import type { BatchBlockMutationResult } from "./batchBlockOperations";
import type {
  AttachmentBlockData,
  Block,
  BlockData,
  BlockStatus,
  BlockType,
  EditorDocument,
  HeadingLevel,
} from "./block";

export const NEXUS_BLOCK_CLIPBOARD_MIME = "application/x-nexus-blocks+json";

const MAX_CLIPBOARD_BYTES = 2 * 1024 * 1024;
const BLOCK_TYPES = new Set<BlockType>([
  "paragraph",
  "heading",
  "todo",
  "quote",
  "code",
  "image",
  "file",
  "table",
  "kanban",
  "divider",
  "bulletedList",
  "numberedList",
  "toggle",
  "formula",
  "linkCard",
]);
const BLOCK_STATUSES = new Set<BlockStatus>(["unset", "todo", "in-progress", "review", "done"]);

export interface ClipboardAttachmentData {
  kind: "image" | "file";
  mimeType: string;
  name: string;
  size: number;
}

export type ClipboardBlockData = Exclude<BlockData, AttachmentBlockData> | ClipboardAttachmentData | null;

export interface ClipboardBlockSnapshot {
  assignee: string;
  checked: boolean;
  content: string;
  data: ClipboardBlockData;
  dueDate: string;
  headingLevel: HeadingLevel;
  richText: RichTextDocument | null;
  sourceChildren: string[];
  sourceId: string;
  sourceParentId: string | null;
  status: BlockStatus;
  type: BlockType;
}

export interface NexusBlockClipboardPayload {
  blocks: ClipboardBlockSnapshot[];
  copiedAt: number;
  sourceDocumentId: string;
  sourceWorkspaceId: string;
  version: 1;
}

export interface ClipboardPayloadParseResult {
  payload: NexusBlockClipboardPayload | null;
  reason?: string;
}

export interface MaterializeClipboardBlocksOptions {
  nextId: () => string;
  now: number;
  targetWorkspaceId: string;
}

const INVALID_PAYLOAD = "块剪贴板内容无效";
const INVALID_RELATION = "块剪贴板关系无效";

export function createBlockClipboardPayload(
  document: EditorDocument,
  requestedBlockIds: string[],
  sourceWorkspaceId: string,
  copiedAt: number,
): NexusBlockClipboardPayload {
  const resolved = resolveBlockSelection(document.blocks, {
    anchorBlockId: null,
    selectedBlockIds: requestedBlockIds,
  });
  const selectedIds = collectSubtreeIds(document.blocks, resolved.rootBlockIds);
  const blocks = document.blocks
    .filter((block) => selectedIds.has(block.id))
    .map((block) => snapshotBlock(block, selectedIds));

  if (blocks.length === 0) {
    throw new Error("未找到可复制的块");
  }

  return {
    blocks,
    copiedAt,
    sourceDocumentId: document.id,
    sourceWorkspaceId,
    version: 1,
  };
}

export function parseBlockClipboardPayload(value: unknown): ClipboardPayloadParseResult {
  if (!isRecord(value)) {
    return { payload: null, reason: INVALID_PAYLOAD };
  }
  if (value.version !== 1) {
    return { payload: null, reason: "不支持的块剪贴板版本" };
  }
  if (serializedSize(value) > MAX_CLIPBOARD_BYTES) {
    return { payload: null, reason: "块剪贴板内容超过 2 MB" };
  }
  if (
    typeof value.sourceWorkspaceId !== "string" ||
    !value.sourceWorkspaceId ||
    typeof value.sourceDocumentId !== "string" ||
    !value.sourceDocumentId ||
    typeof value.copiedAt !== "number" ||
    !Number.isFinite(value.copiedAt) ||
    !Array.isArray(value.blocks) ||
    value.blocks.length === 0
  ) {
    return { payload: null, reason: INVALID_PAYLOAD };
  }

  const blocks = value.blocks.map(parseClipboardBlock);
  if (blocks.some((block) => !block)) {
    return { payload: null, reason: INVALID_PAYLOAD };
  }

  const payload: NexusBlockClipboardPayload = {
    blocks: blocks as ClipboardBlockSnapshot[],
    copiedAt: value.copiedAt,
    sourceDocumentId: value.sourceDocumentId,
    sourceWorkspaceId: value.sourceWorkspaceId,
    version: 1,
  };

  return hasValidRelations(payload.blocks)
    ? { payload }
    : { payload: null, reason: INVALID_RELATION };
}

export function materializeClipboardBlocks(
  payload: NexusBlockClipboardPayload,
  options: MaterializeClipboardBlocksOptions,
): Block[] {
  const sourceIds = new Set(payload.blocks.map((block) => block.sourceId));
  const idMap = new Map<string, string>();
  const usedIds = new Set<string>();

  for (const sourceId of sourceIds) {
    const id = options.nextId();
    if (!id || usedIds.has(id)) {
      throw new Error("复制块 ID 无效");
    }
    usedIds.add(id);
    idMap.set(sourceId, id);
  }

  const crossesWorkspace = payload.sourceWorkspaceId !== options.targetWorkspaceId;
  return payload.blocks.map((snapshot) => materializeBlock(snapshot, idMap, options, crossesWorkspace));
}

export function insertClipboardBlocksAfter(
  document: EditorDocument,
  targetBlockId: string,
  insertedBlocks: Block[],
  now: number,
): BatchBlockMutationResult {
  const targetIndex = document.blocks.findIndex((block) => block.id === targetBlockId);
  const target = document.blocks[targetIndex];
  if (!target || !hasValidInsertedTree(document, insertedBlocks)) {
    return { affectedBlockIds: [], document, focusBlockId: null };
  }

  const insertedIds = new Set(insertedBlocks.map((block) => block.id));
  const rootIds = insertedBlocks.filter((block) => block.parentId === null).map((block) => block.id);
  const targetSubtreeIds = collectSubtreeIds(document.blocks, [target.id]);
  const lastTargetIndex = document.blocks.reduce(
    (lastIndex, block, index) => targetSubtreeIds.has(block.id) ? index : lastIndex,
    targetIndex,
  );
  const parentId = target.parentId;
  const nextInsertedBlocks = insertedBlocks.map((block) =>
    block.parentId === null
      ? { ...block, parentId, updatedAt: now }
      : block,
  );
  const nextBlocks = document.blocks.map((block) => {
    if (block.id !== parentId) {
      return block;
    }

    const targetPosition = block.children.indexOf(target.id);
    return {
      ...block,
      children: [
        ...block.children.slice(0, targetPosition + 1),
        ...rootIds,
        ...block.children.slice(targetPosition + 1),
      ],
      updatedAt: now,
    };
  });

  return {
    affectedBlockIds: nextInsertedBlocks.map((block) => block.id),
    document: {
      ...document,
      blocks: [
        ...nextBlocks.slice(0, lastTargetIndex + 1),
        ...nextInsertedBlocks,
        ...nextBlocks.slice(lastTargetIndex + 1),
      ],
      updatedAt: now,
    },
    focusBlockId: rootIds[0] ?? null,
  };
}

export function clipboardPayloadToPlainText(payload: NexusBlockClipboardPayload): string {
  return payload.blocks.map((block) => block.content || attachmentName(block.data) || "").join("\n");
}

export function clipboardPayloadToSafeHtml(payload: NexusBlockClipboardPayload): string {
  return payload.blocks.map((block) => blockToSafeHtml(block)).join("");
}

function snapshotBlock(block: Block, selectedIds: Set<string>): ClipboardBlockSnapshot {
  const richText = isRichTextBlockType(block.type)
    ? normalizeRichText(block.richText ?? createRichTextFromPlainText(block.content))
    : null;
  const attachmentContent = attachmentName(block.data);

  return {
    assignee: block.assignee,
    checked: block.checked,
    content: attachmentContent ?? block.content,
    data: toClipboardData(block.data),
    dueDate: block.dueDate,
    headingLevel: block.headingLevel,
    richText,
    sourceChildren: block.children.filter((childId) => selectedIds.has(childId)),
    sourceId: block.id,
    sourceParentId: block.parentId && selectedIds.has(block.parentId) ? block.parentId : null,
    status: block.status,
    type: block.type,
  };
}

function parseClipboardBlock(value: unknown): ClipboardBlockSnapshot | null {
  if (!isRecord(value) || !isBlockType(value.type) || !isHeadingLevel(value.headingLevel)) {
    return null;
  }
  if (
    typeof value.sourceId !== "string" ||
    !value.sourceId ||
    (value.sourceParentId !== null && typeof value.sourceParentId !== "string") ||
    !Array.isArray(value.sourceChildren) ||
    value.sourceChildren.some((childId) => typeof childId !== "string" || !childId) ||
    new Set(value.sourceChildren).size !== value.sourceChildren.length ||
    typeof value.content !== "string" ||
    typeof value.checked !== "boolean" ||
    typeof value.assignee !== "string" ||
    typeof value.dueDate !== "string" ||
    !isBlockStatus(value.status)
  ) {
    return null;
  }

  const data = parseClipboardData(value.data);
  if (data === undefined) {
    return null;
  }

  try {
    const richText = isRichTextBlockType(value.type)
      ? normalizeRichText(value.richText ?? createRichTextFromPlainText(value.content))
      : value.richText === null ? null : null;
    if (!isRichTextBlockType(value.type) && value.richText !== null) {
      return null;
    }

    return {
      assignee: value.assignee,
      checked: value.checked,
      content: value.content,
      data,
      dueDate: value.dueDate,
      headingLevel: value.headingLevel,
      richText,
      sourceChildren: [...value.sourceChildren],
      sourceId: value.sourceId,
      sourceParentId: value.sourceParentId,
      status: value.status,
      type: value.type,
    };
  } catch {
    return null;
  }
}

function materializeBlock(
  snapshot: ClipboardBlockSnapshot,
  idMap: Map<string, string>,
  options: MaterializeClipboardBlocksOptions,
  crossesWorkspace: boolean,
): Block {
  const attachment = isClipboardAttachmentData(snapshot.data) ? snapshot.data : null;
  const type = crossesWorkspace && attachment ? "paragraph" : snapshot.type;
  const content = crossesWorkspace && attachment ? attachment.name : snapshot.content;
  const data = attachment ? null : cloneBlockData(snapshot.data);

  return {
    assignee: crossesWorkspace ? "" : snapshot.assignee,
    checked: type === "todo" ? snapshot.checked : false,
    children: snapshot.sourceChildren.map((sourceId) => idMap.get(sourceId)!),
    comments: [],
    content,
    createdAt: options.now,
    data,
    dueDate: crossesWorkspace ? "" : snapshot.dueDate,
    headingLevel: type === "heading" ? snapshot.headingLevel : 1,
    id: idMap.get(snapshot.sourceId)!,
    parentId: snapshot.sourceParentId ? idMap.get(snapshot.sourceParentId)! : null,
    richText: isRichTextBlockType(type)
      ? normalizeRichText(snapshot.richText ?? createRichTextFromPlainText(content))
      : null,
    status: crossesWorkspace ? "unset" : snapshot.status,
    type,
    updatedAt: options.now,
  };
}

function toClipboardData(data: BlockData | null): ClipboardBlockData {
  if (!data) {
    return null;
  }
  if (data.kind === "image" || data.kind === "file") {
    return {
      kind: data.kind,
      mimeType: data.mimeType,
      name: data.name,
      size: data.size,
    };
  }
  return structuredClone(data);
}

function parseClipboardData(value: unknown): ClipboardBlockData | undefined {
  if (value === null) {
    return null;
  }
  if (!isRecord(value) || typeof value.kind !== "string") {
    return undefined;
  }
  if (value.kind === "image" || value.kind === "file") {
    return typeof value.mimeType === "string" && typeof value.name === "string" && value.name &&
      typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0
      ? { kind: value.kind, mimeType: value.mimeType, name: value.name, size: value.size }
      : undefined;
  }
  if (value.kind === "toggle" && typeof value.collapsed === "boolean") {
    return { collapsed: value.collapsed, kind: "toggle" };
  }
  if (value.kind === "formula" && typeof value.latex === "string") {
    return { kind: "formula", latex: value.latex };
  }
  if (
    value.kind === "linkCard" &&
    typeof value.url === "string" &&
    typeof value.title === "string" &&
    typeof value.description === "string"
  ) {
    const url = normalizeRichTextLink(value.url);
    return url ? { description: value.description, kind: "linkCard", title: value.title, url } : undefined;
  }
  if (value.kind === "table" && Array.isArray(value.columns) && Array.isArray(value.rows)) {
    const columns = value.columns.map((column) => isRecord(column) && typeof column.id === "string" && typeof column.name === "string"
      ? { id: column.id, name: column.name }
      : null);
    const rows = value.rows.map((row) => {
      if (!isRecord(row) || typeof row.id !== "string" || !isRecord(row.cells)) return null;
      const cells = Object.entries(row.cells).every(([key, cell]) => key && typeof cell === "string")
        ? Object.fromEntries(Object.entries(row.cells) as Array<[string, string]>)
        : null;
      return cells ? { cells, id: row.id } : null;
    });
    return columns.every(Boolean) && rows.every(Boolean)
      ? { columns: columns as Array<{ id: string; name: string }>, kind: "table", rows: rows as Array<{ cells: Record<string, string>; id: string }> }
      : undefined;
  }
  if (value.kind === "kanban" && Array.isArray(value.columns)) {
    const columns = value.columns.map((column) => {
      if (!isRecord(column) || typeof column.id !== "string" || typeof column.title !== "string" || !Array.isArray(column.cards)) {
        return null;
      }
      const cards = column.cards.map((card) => isRecord(card) && typeof card.id === "string" && typeof card.title === "string"
        ? { id: card.id, title: card.title }
        : null);
      return cards.every(Boolean) ? { cards: cards as Array<{ id: string; title: string }>, id: column.id, title: column.title } : null;
    });
    return columns.every(Boolean)
      ? { columns: columns as Array<{ cards: Array<{ id: string; title: string }>; id: string; title: string }>, kind: "kanban" }
      : undefined;
  }
  return undefined;
}

function hasValidRelations(blocks: ClipboardBlockSnapshot[]): boolean {
  const blocksById = new Map(blocks.map((block) => [block.sourceId, block]));
  if (blocksById.size !== blocks.length) {
    return false;
  }

  for (const block of blocks) {
    const parent = block.sourceParentId ? blocksById.get(block.sourceParentId) : null;
    if (block.sourceParentId && (!parent || !parent.sourceChildren.includes(block.sourceId))) {
      return false;
    }
    for (const childId of block.sourceChildren) {
      const child = blocksById.get(childId);
      if (!child || child.sourceParentId !== block.sourceId) {
        return false;
      }
    }
  }

  return blocks.some((block) => block.sourceParentId === null) && blocks.every((block) => !hasParentCycle(block, blocksById));
}

function hasParentCycle(block: ClipboardBlockSnapshot, blocksById: Map<string, ClipboardBlockSnapshot>): boolean {
  const visitedIds = new Set<string>();
  let current: ClipboardBlockSnapshot | undefined = block;

  while (current?.sourceParentId) {
    if (visitedIds.has(current.sourceId)) {
      return true;
    }
    visitedIds.add(current.sourceId);
    current = blocksById.get(current.sourceParentId);
  }
  return false;
}

function collectSubtreeIds(blocks: Block[], rootIds: string[]): Set<string> {
  const blocksById = new Map(blocks.map((block) => [block.id, block]));
  const selectedIds = new Set<string>();
  const pendingIds = [...rootIds];

  while (pendingIds.length > 0) {
    const id = pendingIds.pop()!;
    if (selectedIds.has(id) || !blocksById.has(id)) {
      continue;
    }
    selectedIds.add(id);
    pendingIds.push(...blocksById.get(id)!.children);
  }

  return selectedIds;
}

function hasValidInsertedTree(document: EditorDocument, insertedBlocks: Block[]): boolean {
  if (insertedBlocks.length === 0) {
    return false;
  }

  const existingIds = new Set(document.blocks.map((block) => block.id));
  const insertedIds = new Set(insertedBlocks.map((block) => block.id));
  if (insertedIds.size !== insertedBlocks.length || [...insertedIds].some((id) => existingIds.has(id))) {
    return false;
  }

  const byId = new Map(insertedBlocks.map((block) => [block.id, block]));
  return insertedBlocks.some((block) => block.parentId === null) && insertedBlocks.every((block) => {
    const parent = block.parentId ? byId.get(block.parentId) : null;
    if (block.parentId && (!parent || !parent.children.includes(block.id))) {
      return false;
    }
    return block.children.every((childId) => byId.get(childId)?.parentId === block.id);
  });
}

function blockToSafeHtml(block: ClipboardBlockSnapshot): string {
  const content = block.richText ? richTextToSafeHtml(block.richText) : escapeHtml(block.content || attachmentName(block.data) || "");
  if (block.type === "heading") {
    return `<h${block.headingLevel}>${content}</h${block.headingLevel}>`;
  }
  if (block.type === "quote") {
    return `<blockquote>${content}</blockquote>`;
  }
  if (block.type === "code") {
    return `<pre><code>${content}</code></pre>`;
  }
  return `<p>${content}</p>`;
}

function richTextToSafeHtml(document: RichTextDocument): string {
  return document.content[0].content?.map((node) => {
    if (node.type === "hardBreak") {
      return "<br>";
    }
    if (node.type === "mention") {
      return escapeHtml(`@${node.attrs.label}`);
    }

    let content = escapeHtml(node.text);
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") content = `<strong>${content}</strong>`;
      if (mark.type === "italic") content = `<em>${content}</em>`;
      if (mark.type === "strike") content = `<s>${content}</s>`;
      if (mark.type === "code") content = `<code>${content}</code>`;
      if (mark.type === "link") content = `<a href="${escapeAttribute(mark.attrs.href)}">${content}</a>`;
    }
    return content;
  }).join("") ?? "";
}

function cloneBlockData(data: ClipboardBlockData): BlockData | null {
  return data && !isClipboardAttachmentData(data) ? structuredClone(data) : null;
}

function attachmentName(data: BlockData | ClipboardBlockData | null): string | null {
  return data && (data.kind === "image" || data.kind === "file") ? data.name : null;
}

function isClipboardAttachmentData(data: ClipboardBlockData): data is ClipboardAttachmentData {
  if (!data) {
    return false;
  }

  return (data.kind === "image" || data.kind === "file") && !("key" in data);
}

function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && BLOCK_TYPES.has(value as BlockType);
}

function isBlockStatus(value: unknown): value is BlockStatus {
  return typeof value === "string" && BLOCK_STATUSES.has(value as BlockStatus);
}

function isHeadingLevel(value: unknown): value is HeadingLevel {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function serializedSize(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" ? new TextEncoder().encode(serialized).byteLength : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
