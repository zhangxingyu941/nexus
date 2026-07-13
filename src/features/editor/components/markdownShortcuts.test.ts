import { describe, expect, it } from "vitest";
import { isSlashCommandTrigger, resolveMarkdownShortcut } from "./markdownShortcuts";

describe("markdown shortcuts", () => {
  it("resolves complete markdown triggers only after the trailing space", () => {
    expect(resolveMarkdownShortcut("# ")).toBe("heading");
    expect(resolveMarkdownShortcut("> ")).toBe("quote");
    expect(resolveMarkdownShortcut("[] ")).toBe("todo");
    expect(resolveMarkdownShortcut("``` ")).toBe("code");
    expect(resolveMarkdownShortcut("#")).toBeNull();
  });

  it("detects a standalone slash command trigger", () => {
    expect(isSlashCommandTrigger("/")).toBe(true);
    expect(isSlashCommandTrigger("/标题")).toBe(false);
  });
});
