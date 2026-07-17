import { describe, expect, it } from "vitest";
import {
  EDITOR_COMMANDS,
  getEditorCommand,
  getEditorCommandsByCategory,
  searchEditorCommands,
} from "./editorCommands";

describe("editor commands", () => {
  it("defines unique command ids and all six heading levels", () => {
    expect(new Set(EDITOR_COMMANDS.map((command) => command.id)).size).toBe(EDITOR_COMMANDS.length);
    expect(
      EDITOR_COMMANDS.filter((command) => command.type === "heading").map((command) => command.headingLevel),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(getEditorCommand("heading-6")).toMatchObject({
      category: "text",
      headingLevel: 6,
      label: "H6",
      type: "heading",
    });
  });

  it("groups commands and searches labels, aliases, descriptions, and markdown triggers", () => {
    expect(getEditorCommandsByCategory("media").map((command) => command.label)).toEqual(["Image", "File", "Link Card"]);
    expect(searchEditorCommands("表格").map((command) => command.id)).toEqual(["table"]);
    expect(searchEditorCommands("task").map((command) => command.id)).toContain("todo");
    expect(searchEditorCommands("一级标题").map((command) => command.id)).toContain("heading-1");
    expect(searchEditorCommands("######").map((command) => command.id)).toEqual(["heading-6"]);
  });
});
