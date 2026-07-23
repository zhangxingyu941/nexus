import { describe, expect, it } from "vitest";
import { createRichTextFromPlainText } from "./richText";
import type { EditorDocument } from "../features/editor/model/block";
import { parseMarkdownDocument, serializeDocumentToMarkdown } from "./markdownDocument";

describe("markdown document conversion", () => {
  it("uses the first top-level h1 as title and does not emit it as a body block", () => {
    const result = parseMarkdownDocument("# 设计说明\n\n正文", {
      filename: "fallback.md",
      now: 1,
    });

    expect(result.document?.title).toBe("设计说明");
    expect(result.document?.blocks.map((block) => block.type)).toEqual(["paragraph"]);
  });

  it("reports line and column for unsafe links and raw HTML", () => {
    const result = parseMarkdownDocument("[x](javascript:alert(1))\n\n<div>bad</div>", {
      filename: "safe.md",
      now: 1,
    });

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "markdown_link_invalid", line: 1, severity: "error" }),
      expect.objectContaining({ code: "markdown_html_unsupported", line: 3, severity: "error" }),
    ]));
    expect(result.document).toBeNull();
  });

  it("maps headings, quotes, tasks, lists, tables, code, formulas, and hard breaks", () => {
    const result = parseMarkdownDocument([
      "## 二级标题",
      "",
      "> 引用",
      "",
      "- [x] 完成",
      "",
      "1. 第一项",
      "   - 子项",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```math",
      "x^2",
      "```",
      "",
      "a  ",
      "b",
    ].join("\n"), {
      filename: "mapping.md",
      nextId: createIds(),
      now: 10,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.document?.blocks).toMatchObject([
      { type: "heading", headingLevel: 2 },
      { type: "quote" },
      { type: "todo", checked: true },
      { type: "numberedList" },
      { type: "bulletedList", parentId: "block-3" },
      { type: "table" },
      { type: "formula", content: "x^2" },
      { type: "paragraph", richText: expect.objectContaining({ type: "doc" }) },
    ]);
    expect(result.document?.blocks.at(-1)?.content).toBe("a\nb");
  });

  it("fails atomically for excessive list depth and block count", () => {
    const tooDeep = Array.from(
      { length: 11 },
      (_, index) => `${"    ".repeat(index)}- level ${index}`,
    ).join("\n");
    const tooManyBlocks = Array.from({ length: 5001 }, () => "block").join("\n\n");

    const deepResult = parseMarkdownDocument(tooDeep, {
      filename: "deep.md",
      nextId: createIds(),
      now: 10,
    });
    const largeResult = parseMarkdownDocument(tooManyBlocks, {
      filename: "large.md",
      nextId: createIds(),
      now: 10,
    });

    expect(deepResult.document).toBeNull();
    expect(deepResult.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "markdown_depth_limit", severity: "error" }),
    ]));
    expect(largeResult.document).toBeNull();
    expect(largeResult.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "markdown_block_limit", severity: "error" }),
    ]));
  });

  it("preserves inline marks and downgrades remote images to safe links", () => {
    const result = parseMarkdownDocument(
      "**粗体** *斜体* ~~删除~~ `代码` [链接](https://example.com) ![架构图](https://example.com/diagram.png)",
      { filename: "inline.md", now: 10 },
    );

    expect(result.document?.blocks[0]).toMatchObject({
      content: "粗体 斜体 删除 代码 链接 架构图",
      richText: {
        content: [{
          content: expect.arrayContaining([
            expect.objectContaining({ marks: [{ type: "bold" }], text: "粗体" }),
            expect.objectContaining({ marks: [{ type: "italic" }], text: "斜体" }),
            expect.objectContaining({ marks: [{ type: "strike" }], text: "删除" }),
            expect.objectContaining({ marks: [{ type: "code" }], text: "代码" }),
            expect.objectContaining({ marks: [{ attrs: { href: "https://example.com" }, type: "link" }], text: "链接" }),
            expect.objectContaining({ marks: [{ attrs: { href: "https://example.com/diagram.png" }, type: "link" }], text: "架构图" }),
          ]),
        }],
        type: "doc",
      },
    });
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "markdown_remote_image_downgraded", severity: "warning" }),
    ]));
    expect(result.resources).toEqual([{ alt: "架构图", url: "https://example.com/diagram.png" }]);
  });

  it("maps standalone archive assets to attachment blocks", () => {
    const result = parseMarkdownDocument(
      "![Diagram](assets/diagram.png)\n\n[Notes](assets/notes.txt)",
      {
        assets: new Map([
          ["assets/diagram.png", {
            key: "workspace-1/diagram.png",
            mimeType: "image/png",
            name: "diagram.png",
            path: "assets/diagram.png",
            size: 12,
          }],
          ["assets/notes.txt", {
            key: "workspace-1/notes.txt",
            mimeType: "text/plain",
            name: "notes.txt",
            path: "assets/notes.txt",
            size: 5,
          }],
        ]),
        filename: "archive.zip",
        now: 10,
      },
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.document?.blocks).toMatchObject([
      { data: { key: "workspace-1/diagram.png", kind: "image" }, type: "image" },
      { data: { key: "workspace-1/notes.txt", kind: "file" }, type: "file" },
    ]);
  });

  it("serializes supported text blocks deterministically", () => {
    const document: EditorDocument = {
      blocks: [
        markdownBlock("paragraph", "正文"),
        markdownBlock("heading", "二级标题", { headingLevel: 2 }),
        markdownBlock("quote", "引用"),
        markdownBlock("todo", "完成", { checked: true }),
        markdownBlock("code", "const value = 1;"),
        markdownBlock("divider", ""),
      ],
      id: "document-1",
      title: "设计说明",
      updatedAt: 10,
    };

    const first = serializeDocumentToMarkdown(document);
    const second = serializeDocumentToMarkdown(document);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      diagnostics: [],
      markdown: "# 设计说明\n\n正文\n\n## 二级标题\n\n> 引用\n\n- [x] 完成\n\n```\nconst value = 1;\n```\n\n---\n",
      resources: [],
    });
  });

  it("serializes marked text, nested lists, tables, formulas, and attachments", () => {
    const document: EditorDocument = {
      blocks: [
        markdownBlock("bulletedList", "parent", { children: ["child"], id: "parent" }),
        markdownBlock("bulletedList", "child", { id: "child", parentId: "parent" }),
        markdownBlock("paragraph", "plain", {
          id: "marked",
          richText: {
            content: [{ content: [
              { marks: [{ type: "bold" }], text: "bold", type: "text" },
              { text: " and ", type: "text" },
              { marks: [{ attrs: { href: "https://example.com" }, type: "link" }], text: "link", type: "text" },
              { type: "hardBreak" },
              { marks: [{ type: "code" }], text: "code", type: "text" },
            ], type: "paragraph" }],
            type: "doc",
          },
        }),
        markdownBlock("table", "", {
          data: {
            columns: [{ id: "name", name: "Name" }, { id: "value", name: "Value" }],
            kind: "table",
            rows: [{ cells: { name: "one", value: "two" }, id: "row-1" }],
          },
        }),
        markdownBlock("formula", "x^2", { data: { kind: "formula", latex: "x^2" } }),
        markdownBlock("image", "", {
          data: {
            key: "documents/private-image",
            kind: "image",
            mimeType: "image/png",
            name: "diagram.png",
            size: 12,
            url: "/api/files/diagram",
          },
        }),
      ],
      id: "document-1",
      title: "Export",
      updatedAt: 10,
    };

    const result = serializeDocumentToMarkdown(document);

    expect(result.diagnostics).toEqual([]);
    expect(result.markdown).toContain("- parent\n  - child");
    expect(result.markdown).toContain("**bold** and [link](https://example.com)  \n`code`");
    expect(result.markdown).toContain("| Name | Value |\n| --- | --- |\n| one | two |");
    expect(result.markdown).toContain("```math\nx^2\n```");
    expect(result.markdown).toContain("![diagram.png](assets/diagram.png-");
    expect(result.resources).toEqual([expect.objectContaining({ mimeType: "image/png", name: "diagram.png", size: 12 })]);
    expect(result.resources[0]?.path).not.toContain("documents/private-image");
  });

  it("downgrades mentions and complex blocks visibly, and rejects invalid list relations", () => {
    const document: EditorDocument = {
      blocks: [
        markdownBlock("paragraph", "@Ada", {
          richText: {
            content: [{ content: [{
              attrs: { kind: "person", label: "Ada", targetId: "person-1" },
              type: "mention",
            }], type: "paragraph" }],
            type: "doc",
          },
        }),
        markdownBlock("toggle", "Details"),
        markdownBlock("kanban", "", {
          data: { columns: [{ cards: [{ id: "card-1", title: "Ship" }], id: "todo", title: "Todo" }], kind: "kanban" },
        }),
        markdownBlock("numberedList", "orphan", { id: "orphan", parentId: "missing" }),
      ],
      id: "document-1",
      title: "Export",
      updatedAt: 10,
    };

    const result = serializeDocumentToMarkdown(document);

    expect(result.markdown).toContain("@Ada");
    expect(result.markdown).toContain("Details");
    expect(result.markdown).toContain("Todo\n- Ship");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      "markdown_mention_downgraded",
      "markdown_toggle_downgraded",
      "markdown_kanban_downgraded",
      "markdown_list_relation_invalid",
    ]));
  });
});

function createIds() {
  let index = 0;
  return () => `block-${index++}`;
}

function markdownBlock(type: EditorDocument["blocks"][number]["type"], content: string, overrides: Partial<EditorDocument["blocks"][number]> = {}) {
  return {
    assignee: "",
    checked: false,
    children: [],
    comments: [],
    content,
    createdAt: 10,
    data: null,
    dueDate: "",
    headingLevel: 1 as const,
    id: `block-${type}`,
    parentId: null,
    richText: ["paragraph", "heading", "quote", "todo"].includes(type) ? createRichTextFromPlainText(content) : null,
    status: "unset" as const,
    type,
    updatedAt: 10,
    ...overrides,
  };
}
