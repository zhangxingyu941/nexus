import type { BlockType } from "../model/block";

const MARKDOWN_SHORTCUTS: Record<string, BlockType> = {
  "# ": "heading",
  "> ": "quote",
  "[] ": "todo",
  "``` ": "code",
};

export function resolveMarkdownShortcut(text: string): BlockType | null {
  return MARKDOWN_SHORTCUTS[text] ?? null;
}

export function isSlashCommandTrigger(text: string): boolean {
  return text === "/";
}
