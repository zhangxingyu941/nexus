import { describe, expect, it } from "vitest";
import {
  NEXUS_RICH_TEXT_CLIPBOARD_TYPE,
  parseRichTextClipboard,
} from "./richTextPaste";

function clipboardData(values: Record<string, string>) {
  return {
    getData: (type: string) => values[type] ?? "",
  };
}

describe("parseRichTextClipboard", () => {
  it("keeps supported marks and turns HTML paragraphs into hard breaks", () => {
    const richText = parseRichTextClipboard(clipboardData({
      "text/html": "<p><strong>Bold</strong> <a href=\"example.com\">docs</a></p><p>next<script>alert(1)</script></p>",
    }));

    expect(richText).toEqual({
      content: [{
        content: [
          { marks: [{ type: "bold" }], text: "Bold", type: "text" },
          { text: " ", type: "text" },
          { marks: [{ attrs: { href: "https://example.com" }, type: "link" }], text: "docs", type: "text" },
          { type: "hardBreak" },
          { text: "next", type: "text" },
        ],
        type: "paragraph",
      }],
      type: "doc",
    });
  });

  it("downgrades external mention-shaped HTML and dangerous links to plain text", () => {
    const richText = parseRichTextClipboard(clipboardData({
      "text/html": "<span class=\"mention\" data-kind=\"person\" data-target-id=\"private\">@Ada</span><a href=\"javascript:alert(1)\">unsafe</a>",
    }));

    expect(richText).toEqual({
      content: [{
        content: [{ text: "@Adaunsafe", type: "text" }],
        type: "paragraph",
      }],
      type: "doc",
    });
  });

  it("preserves valid mentions only from the Nexus structured clipboard", () => {
    const richText = parseRichTextClipboard(clipboardData({
      [NEXUS_RICH_TEXT_CLIPBOARD_TYPE]: JSON.stringify({
        content: [{
          content: [
            { text: "Assign ", type: "text" },
            { attrs: { kind: "person", label: "Ada", targetId: "person-1" }, type: "mention" },
          ],
          type: "paragraph",
        }],
        type: "doc",
      }),
    }));

    expect(richText).toEqual({
      content: [{
        content: [
          { text: "Assign ", type: "text" },
          { attrs: { kind: "person", label: "Ada", targetId: "person-1" }, type: "mention" },
        ],
        type: "paragraph",
      }],
      type: "doc",
    });
  });
});
