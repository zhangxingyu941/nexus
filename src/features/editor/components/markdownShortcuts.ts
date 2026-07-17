import { EDITOR_COMMANDS } from "../commands/editorCommands";
import type { BlockType, HeadingLevel } from "../model/block";

export interface MarkdownCommandMatch {
  headingLevel?: HeadingLevel;
  type: BlockType;
}

export function resolveMarkdownShortcut(text: string): MarkdownCommandMatch | null {
  const command = EDITOR_COMMANDS.find((item) => item.markdown && `${item.markdown} ` === text);

  if (!command) {
    return null;
  }

  return command.headingLevel
    ? { headingLevel: command.headingLevel, type: command.type }
    : { type: command.type };
}

export function isSlashCommandTrigger(text: string): boolean {
  return text === "/";
}
