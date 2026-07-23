import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import {
  createRichTextFromPlainText,
  normalizeRichText,
  normalizeRichTextLink,
  type RichTextDocument,
  type RichTextInlineNode,
  type RichTextMark,
} from "./richText";
import type { Block, BlockType, EditorDocument, HeadingLevel } from "../features/editor/model/block";

export interface MarkdownDiagnostic {
  code: string;
  column: number;
  line: number;
  message: string;
  severity: "error" | "warning";
}

export interface MarkdownResourceReference {
  alt: string;
  url: string;
}

export interface MarkdownExportResource {
  mimeType: string;
  name: string;
  path: string;
  size: number;
}

export interface MarkdownParseOptions {
  documentId?: string;
  filename: string;
  nextId?: () => string;
  now: number;
}

export interface MarkdownParseResult {
  diagnostics: MarkdownDiagnostic[];
  document: EditorDocument | null;
  resources: MarkdownResourceReference[];
}

export interface MarkdownSerializeResult {
  diagnostics: MarkdownDiagnostic[];
  markdown: string;
  resources: MarkdownExportResource[];
}

interface MarkdownPosition {
  start?: { column?: number; line?: number };
}

interface MarkdownNode {
  alt?: string | null;
  children?: MarkdownNode[];
  checked?: boolean | null;
  depth?: number;
  lang?: string | null;
  ordered?: boolean;
  position?: MarkdownPosition;
  type: string;
  url?: string;
  value?: string;
}

interface MarkdownRoot extends MarkdownNode {
  children: MarkdownNode[];
}

const processor = unified().use(remarkParse).use(remarkGfm);
const MAX_MARKDOWN_BLOCKS = 5000;
const MAX_MARKDOWN_DEPTH = 10;

export function parseMarkdownDocument(source: string, options: MarkdownParseOptions): MarkdownParseResult {
  const root = processor.parse(source) as unknown as MarkdownRoot;
  const diagnostics: MarkdownDiagnostic[] = [];
  const resources: MarkdownResourceReference[] = [];
  collectSafetyDiagnostics(root, diagnostics, resources);

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics, document: null, resources };
  }

  const nextId = createIdFactory(options.nextId);
  const blocks: Block[] = [];
  let title = fallbackTitle(options.filename);
  let foundTitle = false;

  for (const node of root.children) {
    if (node.type === "heading" && node.depth === 1 && !foundTitle) {
      title = nodeText(node);
      foundTitle = true;
      continue;
    }

    blocks.push(...blocksFromNode(node, nextId, options.now, diagnostics));
  }

  if (blocks.length > MAX_MARKDOWN_BLOCKS) {
    diagnostics.push(createDiagnostic("markdown_block_limit", "Markdown 转换后不能超过 5000 个块", root));
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics, document: null, resources };
  }

  if (blocks.length === 0) {
    blocks.push(createBlock("paragraph", "", nextId(), options.now));
  }

  return {
    diagnostics,
    document: {
      blocks,
      id: options.documentId ?? "markdown-document",
      title,
      updatedAt: options.now,
    },
    resources,
  };
}

export function serializeDocumentToMarkdown(document: EditorDocument): MarkdownSerializeResult {
  const diagnostics: MarkdownDiagnostic[] = [];
  const sections = [`# ${document.title || "未命名文档"}`];

  for (const block of document.blocks) {
    const markdown = serializeBlock(block, diagnostics);
    if (markdown !== null) {
      sections.push(markdown);
    }
  }

  return {
    diagnostics,
    markdown: `${sections.join("\n\n")}\n`,
    resources: [],
  };
}

function serializeBlock(block: Block, diagnostics: MarkdownDiagnostic[]): string | null {
  if (block.type === "paragraph") return block.content;
  if (block.type === "heading") return `${"#".repeat(block.headingLevel)} ${block.content}`;
  if (block.type === "quote") return `> ${block.content}`;
  if (block.type === "todo") return `- [${block.checked ? "x" : " "}] ${block.content}`;
  if (block.type === "code") return `\`\`\`\n${block.content}\n\`\`\``;
  if (block.type === "divider") return "---";

  diagnostics.push({
    code: "markdown_block_downgraded",
    column: 1,
    line: 1,
    message: `尚未支持导出块类型：${block.type}`,
    severity: "warning",
  });
  return null;
}

function collectSafetyDiagnostics(
  node: MarkdownNode,
  diagnostics: MarkdownDiagnostic[],
  resources: MarkdownResourceReference[],
) {
  if (node.type === "html") {
    diagnostics.push(createDiagnostic("markdown_html_unsupported", "不支持原始 HTML", node));
  }
  if (node.type === "link" && (!node.url || !normalizeRichTextLink(node.url))) {
    diagnostics.push(createDiagnostic("markdown_link_invalid", "Markdown 链接不安全", node));
  }
  if (node.type === "image") {
    if (!node.url || !normalizeRichTextLink(node.url)) {
      diagnostics.push(createDiagnostic("markdown_link_invalid", "Markdown 图片链接不安全", node));
    } else {
      diagnostics.push(createDiagnostic("markdown_remote_image_downgraded", "远程图片已降级为安全链接", node, "warning"));
      resources.push({ alt: node.alt ?? "", url: node.url });
    }
  }

  for (const child of node.children ?? []) {
    collectSafetyDiagnostics(child, diagnostics, resources);
  }
}

function blocksFromNode(
  node: MarkdownNode,
  nextId: () => string,
  now: number,
  diagnostics: MarkdownDiagnostic[],
): Block[] {
  if (node.type === "paragraph") {
    return [createBlock("paragraph", nodeText(node), nextId(), now, { richText: richTextFromNode(node) })];
  }
  if (node.type === "heading" && isHeadingLevel(node.depth)) {
    return [createBlock("heading", nodeText(node), nextId(), now, {
      headingLevel: node.depth,
      richText: richTextFromNode(node),
    })];
  }
  if (node.type === "blockquote") {
    return (node.children ?? []).flatMap((child) => {
      if (child.type !== "paragraph") {
        diagnostics.push(createDiagnostic("markdown_node_unsupported", `不支持引用中的 Markdown 节点：${child.type}`, child));
        return [];
      }
      return [createBlock("quote", nodeText(child), nextId(), now, { richText: richTextFromNode(child) })];
    });
  }
  if (node.type === "list") {
    return blocksFromList(node, null, nextId, now, diagnostics, 1);
  }
  if (node.type === "table") {
    return [blockFromTable(node, nextId(), now, diagnostics)];
  }
  if (node.type === "code") {
    const content = node.value ?? "";
    return node.lang === "math"
      ? [createBlock("formula", content, nextId(), now, { data: { kind: "formula", latex: content } })]
      : [createBlock("code", content, nextId(), now)];
  }
  if (node.type === "thematicBreak") {
    return [createBlock("divider", "", nextId(), now)];
  }

  diagnostics.push(createDiagnostic("markdown_node_unsupported", `不支持 Markdown 节点：${node.type}`, node));
  return [];
}

function blocksFromList(
  node: MarkdownNode,
  parentId: string | null,
  nextId: () => string,
  now: number,
  diagnostics: MarkdownDiagnostic[],
  depth: number,
): Block[] {
  if (depth > MAX_MARKDOWN_DEPTH) {
    diagnostics.push(createDiagnostic("markdown_depth_limit", "Markdown 列表层级不能超过 10 层", node));
    return [];
  }

  const blocks: Block[] = [];
  for (const item of node.children ?? []) {
    if (item.type !== "listItem") {
      diagnostics.push(createDiagnostic("markdown_node_unsupported", `不支持列表中的 Markdown 节点：${item.type}`, item));
      continue;
    }

    const contentNode = item.children?.find((child) => child.type === "paragraph");
    if (!contentNode) {
      diagnostics.push(createDiagnostic("markdown_node_unsupported", "列表项缺少文本内容", item));
      continue;
    }

    const type: BlockType = typeof item.checked === "boolean"
      ? "todo"
      : node.ordered ? "numberedList" : "bulletedList";
    const block = createBlock(type, nodeText(contentNode), nextId(), now, {
      checked: item.checked === true,
      parentId,
      richText: type === "todo" ? richTextFromNode(contentNode) : null,
    });
    blocks.push(block);

    for (const child of item.children ?? []) {
      if (child.type === "paragraph") continue;
      if (child.type !== "list") {
        diagnostics.push(createDiagnostic("markdown_node_unsupported", `不支持列表项中的 Markdown 节点：${child.type}`, child));
        continue;
      }
      const nested = blocksFromList(child, block.id, nextId, now, diagnostics, depth + 1);
      block.children.push(...nested.filter((nestedBlock) => nestedBlock.parentId === block.id).map((nestedBlock) => nestedBlock.id));
      blocks.push(...nested);
    }
  }
  return blocks;
}

function blockFromTable(node: MarkdownNode, id: string, now: number, diagnostics: MarkdownDiagnostic[]): Block {
  const tableRows = node.children ?? [];
  const header = tableRows.at(0);
  if (header?.type !== "tableRow") {
    diagnostics.push(createDiagnostic("markdown_table_invalid", "Markdown 表格缺少表头", node));
    return createBlock("table", "", id, now);
  }

  const headerCells = header.children ?? [];
  const columns = headerCells.map((cell, index) => ({ id: `${id}-column-${index}`, name: nodeText(cell) }));
  const rows = tableRows.slice(1).map((row, rowIndex) => ({
    cells: Object.fromEntries((row.children ?? []).map((cell, columnIndex) => [columns[columnIndex]?.id ?? `${id}-column-${columnIndex}`, nodeText(cell)])),
    id: `${id}-row-${rowIndex}`,
  }));
  return createBlock("table", "", id, now, { data: { columns, kind: "table", rows } });
}

function createBlock(
  type: BlockType,
  content: string,
  id: string,
  now: number,
  overrides: Partial<Pick<Block, "checked" | "data" | "headingLevel" | "parentId" | "richText">> = {},
): Block {
  return {
    assignee: "",
    checked: overrides.checked ?? false,
    children: [],
    comments: [],
    content,
    createdAt: now,
    data: overrides.data ?? null,
    dueDate: "",
    headingLevel: overrides.headingLevel ?? 1,
    id,
    parentId: overrides.parentId ?? null,
    richText: overrides.richText ?? (isRichTextBlockType(type) ? createRichTextFromPlainText(content) : null),
    status: "unset",
    type,
    updatedAt: now,
  };
}

function richTextFromNode(node: MarkdownNode): RichTextDocument {
  const content: RichTextInlineNode[] = [];
  appendInlineNodes(node.children ?? [], [], content);
  return normalizeRichText({
    content: [{ ...(content.length > 0 ? { content } : {}), type: "paragraph" }],
    type: "doc",
  });
}

function appendInlineNodes(nodes: MarkdownNode[], marks: RichTextMark[], output: RichTextInlineNode[]) {
  for (const node of nodes) {
    if (node.type === "text" && typeof node.value === "string") {
      output.push({ ...(marks.length > 0 ? { marks } : {}), text: node.value, type: "text" });
      continue;
    }
    if (node.type === "break") {
      output.push({ type: "hardBreak" });
      continue;
    }
    if (node.type === "inlineCode" && typeof node.value === "string") {
      output.push({ marks: [...marks, { type: "code" }], text: node.value, type: "text" });
      continue;
    }
    if (node.type === "strong") {
      appendInlineNodes(node.children ?? [], [...marks, { type: "bold" }], output);
      continue;
    }
    if (node.type === "emphasis") {
      appendInlineNodes(node.children ?? [], [...marks, { type: "italic" }], output);
      continue;
    }
    if (node.type === "delete") {
      appendInlineNodes(node.children ?? [], [...marks, { type: "strike" }], output);
      continue;
    }
    if (node.type === "link" && node.url) {
      const href = normalizeRichTextLink(node.url);
      if (href) appendInlineNodes(node.children ?? [], [...marks, { attrs: { href }, type: "link" }], output);
      continue;
    }
    if (node.type === "image" && node.url) {
      const href = normalizeRichTextLink(node.url);
      const label = node.alt ?? "图片";
      if (href) output.push({ marks: [...marks, { attrs: { href }, type: "link" }], text: label, type: "text" });
      continue;
    }
    appendInlineNodes(node.children ?? [], marks, output);
  }
}

function isRichTextBlockType(type: BlockType) {
  return type === "paragraph" || type === "heading" || type === "quote" || type === "todo";
}

function createDiagnostic(
  code: string,
  message: string,
  node: MarkdownNode,
  severity: MarkdownDiagnostic["severity"] = "error",
): MarkdownDiagnostic {
  return {
    code,
    column: node.position?.start?.column ?? 1,
    line: node.position?.start?.line ?? 1,
    message,
    severity,
  };
}

function createIdFactory(nextId: MarkdownParseOptions["nextId"]) {
  let sequence = 0;
  return nextId ?? (() => `markdown-block-${sequence++}`);
}

function fallbackTitle(filename: string): string {
  const baseName = filename.trim().replace(/\.[^.]+$/, "");
  return baseName || "未命名文档";
}

function isHeadingLevel(value: number | undefined): value is HeadingLevel {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6;
}

function nodeText(node: MarkdownNode): string {
  if (node.type === "break") {
    return "\n";
  }
  if (node.type === "image") {
    return node.alt ?? "图片";
  }
  if (typeof node.value === "string") {
    return node.value;
  }
  return (node.children ?? []).map(nodeText).join("");
}
