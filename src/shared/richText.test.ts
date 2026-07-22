import { describe, expect, it } from "vitest";
import {
  RICH_TEXT_MAX_BYTES,
  RichTextValidationError,
  createRichTextFromPlainText,
  getRichTextSize,
  normalizeRichText,
  normalizeRichTextLink,
  projectRichTextContent,
  toAnonymousRichText,
  type RichTextDocument,
} from "./richText";

describe("rich text contract", () => {
  it("converts plain text lines into one paragraph with hard breaks", () => {
    expect(createRichTextFromPlainText("alpha\nbeta\n")).toEqual({
      content: [{
        content: [
          { text: "alpha", type: "text" },
          { type: "hardBreak" },
          { text: "beta", type: "text" },
          { type: "hardBreak" },
        ],
        type: "paragraph",
      }],
      type: "doc",
    });
    expect(createRichTextFromPlainText("")).toEqual({
      content: [{ type: "paragraph" }],
      type: "doc",
    });
  });

  it("normalizes marks, links, empty nodes, and adjacent text", () => {
    expect(normalizeRichText({
      content: [{
        content: [
          {
            marks: [
              { attrs: { href: "example.com/docs", rel: "ignored" }, type: "link" },
              { type: "italic" },
              { type: "bold" },
              { type: "bold" },
            ],
            text: "alpha",
            type: "text",
          },
          {
            marks: [
              { type: "bold" },
              { attrs: { href: "https://example.com/docs" }, type: "link" },
              { type: "italic" },
            ],
            text: " beta",
            type: "text",
          },
          { text: "", type: "text" },
        ],
        type: "paragraph",
      }],
      type: "doc",
    })).toEqual({
      content: [{
        content: [{
          marks: [
            { type: "bold" },
            { type: "italic" },
            { attrs: { href: "https://example.com/docs" }, type: "link" },
          ],
          text: "alpha beta",
          type: "text",
        }],
        type: "paragraph",
      }],
      type: "doc",
    });
  });

  it("projects mentions and hard breaks to stable plain text", () => {
    const document: RichTextDocument = {
      content: [{
        content: [
          { text: "Hi ", type: "text" },
          {
            attrs: { kind: "person", label: "Ada", targetId: "person-1" },
            type: "mention",
          },
          { type: "hardBreak" },
          { text: "next", type: "text" },
        ],
        type: "paragraph",
      }],
      type: "doc",
    };

    expect(projectRichTextContent(document)).toBe("Hi @Ada\nnext");
  });

  it("removes mention targets from anonymous rich text", () => {
    const document: RichTextDocument = {
      content: [{
        content: [
          { text: "Owner: ", type: "text" },
          {
            attrs: { kind: "person", label: "Ada", targetId: "person-1" },
            type: "mention",
          },
          { text: " today", type: "text" },
        ],
        type: "paragraph",
      }],
      type: "doc",
    };

    const anonymous = toAnonymousRichText(document);

    expect(anonymous).toEqual({
      content: [{
        content: [{ text: "Owner: @Ada today", type: "text" }],
        type: "paragraph",
      }],
      type: "doc",
    });
    expect(JSON.stringify(anonymous)).not.toContain("person-1");
    expect(JSON.stringify(anonymous)).not.toContain("kind");
  });

  it.each([
    ["example.com/docs", "https://example.com/docs"],
    ["https://example.com/docs", "https://example.com/docs"],
    ["http://localhost:3000/docs", "http://localhost:3000/docs"],
    ["mailto:ada@example.com", "mailto:ada@example.com"],
    ["/documents/document-1", "/documents/document-1"],
    ["javascript:alert(1)", null],
    ["data:text/html,unsafe", null],
    ["//example.com/docs", null],
    ["/settings", null],
    ["not a link", null],
  ])("normalizes safe link %s", (value, expected) => {
    expect(normalizeRichTextLink(value)).toBe(expected);
  });

  it.each([
    { content: [], type: "doc" },
    { content: [{ type: "paragraph" }, { type: "paragraph" }], type: "doc" },
    { content: [{ content: [{ type: "image" }], type: "paragraph" }], type: "doc" },
    {
      content: [{ content: [{ marks: [{ type: "underline" }], text: "x", type: "text" }], type: "paragraph" }],
      type: "doc",
    },
    {
      content: [{ content: [{ attrs: { kind: "person", label: "", targetId: "person-1" }, type: "mention" }], type: "paragraph" }],
      type: "doc",
    },
    {
      content: [{ content: [{ marks: [{ attrs: { href: "javascript:alert(1)" }, type: "link" }], text: "x", type: "text" }], type: "paragraph" }],
      type: "doc",
    },
  ])("rejects an invalid document %#", (value) => {
    expect(() => normalizeRichText(value)).toThrow(RichTextValidationError);
  });

  it("measures serialized UTF-8 bytes and rejects oversized JSON", () => {
    const oversized = createRichTextFromPlainText("界".repeat(RICH_TEXT_MAX_BYTES));

    expect(getRichTextSize(oversized)).toBeGreaterThan(RICH_TEXT_MAX_BYTES);
    expect(() => normalizeRichText(oversized)).toThrow(RichTextValidationError);
  });
});
