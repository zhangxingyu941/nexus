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
});
