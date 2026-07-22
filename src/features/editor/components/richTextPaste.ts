import {
  createRichTextFromPlainText,
  normalizeRichText,
  normalizeRichTextLink,
  type RichTextDocument,
  type RichTextInlineNode,
  type RichTextMark,
} from "@/shared/richText";

export const NEXUS_RICH_TEXT_CLIPBOARD_TYPE = "application/x-nexus-rich-text";

interface ClipboardDataLike {
  getData(type: string): string;
}

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "blockquote",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "ul",
]);

const IGNORED_TAGS = new Set(["script", "style", "template"]);

export function parseRichTextClipboard(clipboardData: ClipboardDataLike): RichTextDocument {
  const structured = clipboardData.getData(NEXUS_RICH_TEXT_CLIPBOARD_TYPE);
  if (structured) {
    try {
      return normalizeRichText(JSON.parse(structured));
    } catch {
      // Invalid structured data must not retain mention attributes.
    }
  }

  const html = clipboardData.getData("text/html");
  if (html && typeof DOMParser !== "undefined") {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const nodes: RichTextInlineNode[] = [];
    for (const child of Array.from(parsed.body.childNodes)) {
      appendHtmlNode(child, [], nodes);
    }
    return normalizeRichText({
      content: [{ ...(nodes.length > 0 ? { content: nodes } : {}), type: "paragraph" }],
      type: "doc",
    });
  }

  return createRichTextFromPlainText(
    clipboardData.getData("text/plain").replace(/\r\n?/g, "\n"),
  );
}

function appendHtmlNode(
  node: Node,
  marks: RichTextMark[],
  output: RichTextInlineNode[],
) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (node.textContent) {
      output.push({
        ...(marks.length > 0 ? { marks } : {}),
        text: node.textContent,
        type: "text",
      });
    }
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  const element = node as HTMLElement;
  const tagName = element.tagName.toLowerCase();
  if (IGNORED_TAGS.has(tagName)) {
    return;
  }
  if (tagName === "br") {
    appendHardBreak(output);
    return;
  }

  if (BLOCK_TAGS.has(tagName) && output.length > 0) {
    appendHardBreak(output);
  }

  const nextMarks = applyHtmlMark(tagName, element, marks);
  for (const child of Array.from(element.childNodes)) {
    appendHtmlNode(child, nextMarks, output);
  }
}

function applyHtmlMark(tagName: string, element: HTMLElement, marks: RichTextMark[]) {
  const nextMarks = [...marks];
  if (tagName === "strong" || tagName === "b") {
    nextMarks.push({ type: "bold" });
  } else if (tagName === "em" || tagName === "i") {
    nextMarks.push({ type: "italic" });
  } else if (tagName === "s" || tagName === "strike" || tagName === "del") {
    nextMarks.push({ type: "strike" });
  } else if (tagName === "code") {
    nextMarks.push({ type: "code" });
  } else if (tagName === "a") {
    const href = normalizeRichTextLink(element.getAttribute("href") ?? "");
    if (href) {
      nextMarks.push({ attrs: { href }, type: "link" });
    }
  }
  return nextMarks;
}

function appendHardBreak(output: RichTextInlineNode[]) {
  if (output.at(-1)?.type !== "hardBreak") {
    output.push({ type: "hardBreak" });
  }
}
