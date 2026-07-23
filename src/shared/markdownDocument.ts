import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { createRichTextFromPlainText, normalizeRichTextLink } from "./richText";
import type { Block, EditorDocument, HeadingLevel } from "../features/editor/model/block";

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
  children?: MarkdownNode[];
  depth?: number;
  position?: MarkdownPosition;
  type: string;
  url?: string;
  value?: string;
}

interface MarkdownRoot extends MarkdownNode {
  children: MarkdownNode[];
}

const processor = unified().use(remarkParse).use(remarkGfm);

export function parseMarkdownDocument(source: string, options: MarkdownParseOptions): MarkdownParseResult {
  const root = processor.parse(source) as unknown as MarkdownRoot;
  const diagnostics: MarkdownDiagnostic[] = [];
  collectSafetyDiagnostics(root, diagnostics);

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics, document: null, resources: [] };
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

    const block = blockFromNode(node, nextId, options.now, diagnostics);
    if (block) {
      blocks.push(block);
    }
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { diagnostics, document: null, resources: [] };
  }

  if (blocks.length === 0) {
    blocks.push(createBlock("paragraph", "", 1, nextId(), options.now));
  }

  return {
    diagnostics,
    document: {
      blocks,
      id: options.documentId ?? "markdown-document",
      title,
      updatedAt: options.now,
    },
    resources: [],
  };
}

function collectSafetyDiagnostics(node: MarkdownNode, diagnostics: MarkdownDiagnostic[]) {
  if (node.type === "html") {
    diagnostics.push(createDiagnostic("markdown_html_unsupported", "不支持原始 HTML", node));
  }
  if (node.type === "link" && (!node.url || !normalizeRichTextLink(node.url))) {
    diagnostics.push(createDiagnostic("markdown_link_invalid", "Markdown 链接不安全", node));
  }

  for (const child of node.children ?? []) {
    collectSafetyDiagnostics(child, diagnostics);
  }
}

function blockFromNode(
  node: MarkdownNode,
  nextId: () => string,
  now: number,
  diagnostics: MarkdownDiagnostic[],
): Block | null {
  if (node.type === "paragraph") {
    return createBlock("paragraph", nodeText(node), 1, nextId(), now);
  }
  if (node.type === "heading" && isHeadingLevel(node.depth)) {
    return createBlock("heading", nodeText(node), node.depth, nextId(), now);
  }

  diagnostics.push(createDiagnostic("markdown_node_unsupported", `不支持 Markdown 节点：${node.type}`, node));
  return null;
}

function createBlock(type: "heading" | "paragraph", content: string, headingLevel: HeadingLevel, id: string, now: number): Block {
  return {
    assignee: "",
    checked: false,
    children: [],
    comments: [],
    content,
    createdAt: now,
    data: null,
    dueDate: "",
    headingLevel,
    id,
    parentId: null,
    richText: createRichTextFromPlainText(content),
    status: "unset",
    type,
    updatedAt: now,
  };
}

function createDiagnostic(code: string, message: string, node: MarkdownNode): MarkdownDiagnostic {
  return {
    code,
    column: node.position?.start?.column ?? 1,
    line: node.position?.start?.line ?? 1,
    message,
    severity: "error",
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
  if (typeof node.value === "string") {
    return node.value;
  }
  return (node.children ?? []).map(nodeText).join("");
}
