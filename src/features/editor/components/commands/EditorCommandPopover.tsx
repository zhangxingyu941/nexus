import type { CSSProperties } from "react";
import type {
  EditorCommandCategory,
  EditorCommandDefinition,
} from "../../commands/editorCommands";

export interface EditorPopoverAnchor {
  bottom: number;
  left: number;
  top: number;
}

interface EditorCommandPopoverProps {
  activeIndex: number;
  anchor: EditorPopoverAnchor;
  commands: EditorCommandDefinition[];
  onSelect: (command: EditorCommandDefinition) => void;
  query?: string;
}

const COMMAND_GROUPS: Array<{ category: EditorCommandCategory; label: string }> = [
  { category: "text", label: "Text & Headings" },
  { category: "list", label: "Lists & Tasks" },
  { category: "media", label: "Media" },
  { category: "data", label: "Data & Advanced" },
];

export function EditorCommandPopover({
  activeIndex,
  anchor,
  commands,
  onSelect,
  query = "",
}: EditorCommandPopoverProps) {
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const side = viewportHeight - anchor.bottom >= 320 ? "bottom" : "top";
  const style: CSSProperties = {
    left: Math.max(12, Math.min(anchor.left, viewportWidth - 402)),
    top: side === "bottom" ? anchor.bottom + 8 : anchor.top - 8,
    transform: side === "top" ? "translateY(-100%)" : undefined,
  };

  return (
    <div
      aria-label="插入内容"
      className="editor-command-popover"
      data-side={side}
      role="listbox"
      style={style}
    >
      {query ? <div className="editor-command-query">/{query}</div> : null}
      {COMMAND_GROUPS.map((group) => {
        const groupCommands = commands.filter((command) => command.category === group.category);

        if (groupCommands.length === 0) {
          return null;
        }

        return (
          <section className="editor-command-group" key={group.category}>
            <div className="editor-command-group-label">{group.label}</div>
            {groupCommands.map((command) => {
              const index = commands.indexOf(command);
              const Icon = command.icon;

              return (
                <button
                  aria-label={`${command.label} ${command.description}`}
                  aria-selected={index === activeIndex}
                  className="editor-command-option"
                  key={command.id}
                  onClick={() => onSelect(command)}
                  onPointerDown={(event) => event.preventDefault()}
                  role="option"
                  type="button"
                >
                  <span className="editor-command-icon">
                    <Icon aria-hidden="true" size={16} />
                  </span>
                  <span className="editor-command-copy">
                    <strong>{command.label}</strong>
                    <span>{command.description}</span>
                  </span>
                  {command.markdown ? <kbd>{command.markdown}</kbd> : null}
                </button>
              );
            })}
          </section>
        );
      })}
      {commands.length === 0 ? <div className="editor-command-empty">无匹配内容</div> : null}
    </div>
  );
}
