export type EditorShortcutCategory = "format" | "block" | "navigation" | "workspace";

export interface EditorShortcutDefinition {
  category: EditorShortcutCategory;
  description: string;
  id: string;
  keys: readonly string[];
}

export const EDITOR_SHORTCUTS = [
  { id: "bold", category: "format", description: "加粗", keys: ["Mod", "B"] },
  { id: "italic", category: "format", description: "斜体", keys: ["Mod", "I"] },
  { id: "strike", category: "format", description: "删除线", keys: ["Mod", "Shift", "X"] },
  { id: "inline-code", category: "format", description: "行内代码", keys: ["Mod", "E"] },
  { id: "link", category: "format", description: "添加链接", keys: ["Mod", "K"] },
  { id: "comment", category: "format", description: "添加评论", keys: ["Mod", "Shift", "M"] },
  { id: "move-up", category: "block", description: "上移当前块", keys: ["Alt", "ArrowUp"] },
  { id: "move-down", category: "block", description: "下移当前块", keys: ["Alt", "ArrowDown"] },
  { id: "indent", category: "block", description: "缩进当前块", keys: ["Tab"] },
  { id: "outdent", category: "block", description: "取消缩进", keys: ["Shift", "Tab"] },
  { id: "complete-todo", category: "block", description: "完成待办", keys: ["Mod", "Enter"] },
  { id: "merge-block", category: "block", description: "空块合并到上块", keys: ["Backspace"] },
  { id: "undo", category: "navigation", description: "撤销", keys: ["Mod", "Z"] },
  { id: "redo", category: "navigation", description: "重做", keys: ["Mod", "Shift", "Z"] },
  { id: "search", category: "workspace", description: "快速搜索", keys: ["Mod", "P"] },
  { id: "slash", category: "workspace", description: "插入内容", keys: ["/"] },
  { id: "shortcut-center", category: "workspace", description: "快捷键中心", keys: ["Mod", "/"] },
] as const satisfies readonly EditorShortcutDefinition[];

export function getEditorShortcut(id: string): EditorShortcutDefinition | undefined {
  return EDITOR_SHORTCUTS.find((shortcut) => shortcut.id === id);
}

export function formatShortcutKeys(keys: readonly string[], isMac: boolean): string[] {
  return keys.map((key) => {
    if (key === "Mod") {
      return isMac ? "⌘" : "Ctrl";
    }

    if (key === "ArrowUp") {
      return "↑";
    }

    if (key === "ArrowDown") {
      return "↓";
    }

    return key;
  });
}

interface ShortcutKeyboardEvent {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export function matchesEditorShortcut(
  event: ShortcutKeyboardEvent,
  shortcut: EditorShortcutDefinition | undefined,
): boolean {
  if (!shortcut) {
    return false;
  }

  const keys = shortcut.keys;
  const usesMod = keys.includes("Mod");
  const usesAlt = keys.includes("Alt");
  const usesShift = keys.includes("Shift");
  const inputKey = keys.find((key) => key !== "Mod" && key !== "Alt" && key !== "Shift");

  if (!inputKey || (usesMod ? !event.ctrlKey && !event.metaKey : event.ctrlKey || event.metaKey)) {
    return false;
  }

  if (event.altKey !== usesAlt || event.shiftKey !== usesShift) {
    return false;
  }

  return event.key.toLocaleLowerCase() === inputKey.toLocaleLowerCase();
}
