import { describe, expect, it } from "vitest";
import {
  EDITOR_SHORTCUTS,
  formatShortcutKeys,
  getEditorShortcut,
  matchesEditorShortcut,
} from "./editorShortcuts";

describe("editor shortcuts", () => {
  it("defines unique immutable shortcut ids", () => {
    expect(new Set(EDITOR_SHORTCUTS.map((shortcut) => shortcut.id)).size).toBe(EDITOR_SHORTCUTS.length);
    expect(getEditorShortcut("shortcut-center")).toMatchObject({ keys: ["Mod", "/"] });
  });

  it("shares platform display and keyboard matching from the same definition", () => {
    const shortcut = getEditorShortcut("shortcut-center");
    expect(formatShortcutKeys(shortcut?.keys ?? [], false)).toEqual(["Ctrl", "/"]);
    expect(formatShortcutKeys(shortcut?.keys ?? [], true)).toEqual(["⌘", "/"]);
    expect(matchesEditorShortcut({ altKey: false, ctrlKey: true, key: "/", metaKey: false, shiftKey: false }, shortcut)).toBe(true);
    expect(matchesEditorShortcut({ altKey: false, ctrlKey: false, key: "/", metaKey: false, shiftKey: false }, shortcut)).toBe(false);
  });
});
