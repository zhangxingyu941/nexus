export const RICH_TEXT_MAX_BYTES = 256 * 1024;

export type MentionKind = "person" | "document" | "task" | "date";

export type RichTextMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "strike" }
  | { type: "code" }
  | { attrs: { href: string }; type: "link" };

export type RichTextInlineNode =
  | { marks?: RichTextMark[]; text: string; type: "text" }
  | { type: "hardBreak" }
  | {
      attrs: {
        kind: MentionKind;
        label: string;
        targetId: string;
      };
      type: "mention";
    };

export interface RichTextDocument {
  content: [{ content?: RichTextInlineNode[]; type: "paragraph" }];
  type: "doc";
}

export interface RichTextUpdate {
  content: string;
  richText: RichTextDocument;
}

export type RichTextValidationErrorCode = "invalid-link" | "invalid-structure" | "too-large" | "unsupported-block";

const ERROR_MESSAGES: Record<RichTextValidationErrorCode, string> = {
  "invalid-link": "富文本链接不安全",
  "invalid-structure": "富文本结构不合法",
  "too-large": "富文本 JSON 超过 256 KB",
  "unsupported-block": "非文本块不能携带富文本",
};

export class RichTextValidationError extends Error {
  constructor(readonly code: RichTextValidationErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "RichTextValidationError";
  }
}

const MARK_ORDER: RichTextMark["type"][] = ["bold", "italic", "strike", "code", "link"];
const MENTION_KINDS = new Set<MentionKind>(["person", "document", "task", "date"]);

export function createRichTextFromPlainText(content: string): RichTextDocument {
  if (!content) {
    return { content: [{ type: "paragraph" }], type: "doc" };
  }

  const nodes: RichTextInlineNode[] = [];
  const lines = content.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line) {
      nodes.push({ text: line, type: "text" });
    }
    if (index < lines.length - 1) {
      nodes.push({ type: "hardBreak" });
    }
  }

  return {
    content: [{ ...(nodes.length > 0 ? { content: nodes } : {}), type: "paragraph" }],
    type: "doc",
  };
}

export function normalizeRichText(value: unknown): RichTextDocument {
  if (getRichTextSize(value) > RICH_TEXT_MAX_BYTES) {
    throw new RichTextValidationError("too-large");
  }
  if (!isRecord(value) || value.type !== "doc" || !Array.isArray(value.content) || value.content.length !== 1) {
    throw new RichTextValidationError("invalid-structure");
  }

  const paragraph = value.content[0];
  if (!isRecord(paragraph) || paragraph.type !== "paragraph") {
    throw new RichTextValidationError("invalid-structure");
  }
  if (paragraph.content !== undefined && !Array.isArray(paragraph.content)) {
    throw new RichTextValidationError("invalid-structure");
  }

  const nodes: RichTextInlineNode[] = [];
  for (const node of paragraph.content ?? []) {
    const normalizedNode = normalizeInlineNode(node);
    if (!normalizedNode) {
      continue;
    }

    const previous = nodes.at(-1);
    if (
      previous?.type === "text" &&
      normalizedNode.type === "text" &&
      marksEqual(previous.marks, normalizedNode.marks)
    ) {
      previous.text += normalizedNode.text;
    } else {
      nodes.push(normalizedNode);
    }
  }

  return {
    content: [{ ...(nodes.length > 0 ? { content: nodes } : {}), type: "paragraph" }],
    type: "doc",
  };
}

export function projectRichTextContent(document: RichTextDocument): string {
  return document.content[0].content?.map((node) => {
    if (node.type === "text") return node.text;
    if (node.type === "hardBreak") return "\n";
    return `@${node.attrs.label}`;
  }).join("") ?? "";
}

export function normalizeRichTextLink(value: string): string | null {
  const input = value.trim();
  if (!input || input.startsWith("//")) {
    return null;
  }

  if (input.startsWith("/")) {
    if (!input.startsWith("/documents/") || input === "/documents/" || /\s/.test(input)) {
      return null;
    }
    return input;
  }

  const withProtocol = /^(?:localhost(?::\d+)?|(?:[a-z\d-]+\.)+[a-z]{2,})(?:[/?#].*)?$/i.test(input)
    ? `https://${input}`
    : input;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }

  if (url.protocol === "mailto:") {
    return /^[^\s@]+@[^\s@]+$/.test(url.pathname) ? withProtocol : null;
  }
  if ((url.protocol === "http:" || url.protocol === "https:") && url.hostname) {
    return withProtocol;
  }
  return null;
}

export function toAnonymousRichText(document: RichTextDocument): RichTextDocument {
  const content = document.content[0].content?.map((node): RichTextInlineNode => {
    if (node.type === "mention") {
      return { text: `@${node.attrs.label}`, type: "text" };
    }
    return structuredClone(node);
  });

  return normalizeRichText({
    content: [{ ...(content && content.length > 0 ? { content } : {}), type: "paragraph" }],
    type: "doc",
  });
}

export function getRichTextSize(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string"
      ? new TextEncoder().encode(serialized).byteLength
      : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function normalizeInlineNode(value: unknown): RichTextInlineNode | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw new RichTextValidationError("invalid-structure");
  }

  if (value.type === "hardBreak") {
    return { type: "hardBreak" };
  }

  if (value.type === "text") {
    if (typeof value.text !== "string" || (value.marks !== undefined && !Array.isArray(value.marks))) {
      throw new RichTextValidationError("invalid-structure");
    }
    if (!value.text) {
      return null;
    }

    const marks = normalizeMarks(value.marks ?? []);
    return {
      ...(marks.length > 0 ? { marks } : {}),
      text: value.text,
      type: "text",
    };
  }

  if (value.type === "mention") {
    const attrs = value.attrs;
    if (
      !isRecord(attrs) ||
      !isMentionKind(attrs.kind) ||
      typeof attrs.label !== "string" ||
      !attrs.label.trim() ||
      typeof attrs.targetId !== "string" ||
      !attrs.targetId.trim()
    ) {
      throw new RichTextValidationError("invalid-structure");
    }
    return {
      attrs: {
        kind: attrs.kind,
        label: attrs.label,
        targetId: attrs.targetId,
      },
      type: "mention",
    };
  }

  throw new RichTextValidationError("invalid-structure");
}

function normalizeMarks(values: unknown[]): RichTextMark[] {
  const marks = new Map<RichTextMark["type"], RichTextMark>();

  for (const value of values) {
    if (!isRecord(value) || typeof value.type !== "string" || !MARK_ORDER.includes(value.type as RichTextMark["type"])) {
      throw new RichTextValidationError("invalid-structure");
    }

    if (value.type === "link") {
      if (!isRecord(value.attrs) || typeof value.attrs.href !== "string") {
        throw new RichTextValidationError("invalid-structure");
      }
      const href = normalizeRichTextLink(value.attrs.href);
      if (!href) {
        throw new RichTextValidationError("invalid-link");
      }
      if (!marks.has("link")) {
        marks.set("link", { attrs: { href }, type: "link" });
      }
      continue;
    }

    const type = value.type as Exclude<RichTextMark["type"], "link">;
    if (!marks.has(type)) {
      marks.set(type, { type });
    }
  }

  return MARK_ORDER.flatMap((type) => {
    const mark = marks.get(type);
    return mark ? [mark] : [];
  });
}

function marksEqual(left?: RichTextMark[], right?: RichTextMark[]) {
  return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
}

function isMentionKind(value: unknown): value is MentionKind {
  return typeof value === "string" && MENTION_KINDS.has(value as MentionKind);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
