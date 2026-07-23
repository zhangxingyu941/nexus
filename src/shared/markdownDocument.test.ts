import { describe, expect, it } from "vitest";
import { parseMarkdownDocument } from "./markdownDocument";

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
});

function createIds() {
  let index = 0;
  return () => `block-${index++}`;
}
