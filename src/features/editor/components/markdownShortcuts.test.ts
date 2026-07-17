import { describe, expect, it } from "vitest";
import { isSlashCommandTrigger, resolveMarkdownShortcut } from "./markdownShortcuts";

describe("markdown shortcuts", () => {
  it("resolves complete markdown triggers only after the trailing space", () => {
    expect(resolveMarkdownShortcut("# ")).toEqual({ headingLevel: 1, type: "heading" });
    expect(resolveMarkdownShortcut("## ")).toEqual({ headingLevel: 2, type: "heading" });
    expect(resolveMarkdownShortcut("###### ")).toEqual({ headingLevel: 6, type: "heading" });
    expect(resolveMarkdownShortcut("> ")).toEqual({ type: "quote" });
    expect(resolveMarkdownShortcut("[] ")).toEqual({ type: "todo" });
    expect(resolveMarkdownShortcut("``` ")).toEqual({ type: "code" });
    expect(resolveMarkdownShortcut("#")).toBeNull();
  });

  it("detects a standalone slash command trigger", () => {
    expect(isSlashCommandTrigger("/")).toBe(true);
    expect(isSlashCommandTrigger("/标题")).toBe(false);
  });
});
