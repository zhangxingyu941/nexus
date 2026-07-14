import type { BlockType } from "../../model/block";
import { SLASH_COMMANDS } from "./blockMenuOptions";

interface SlashMenuProps {
  activeIndex: number;
  onSelect: (type: BlockType) => void;
}

export function SlashMenu({ activeIndex, onSelect }: SlashMenuProps) {
  return (
    <div aria-label="插入菜单" className="slash-menu border-border bg-popover text-popover-foreground shadow-xl" role="menu">
      {SLASH_COMMANDS.map((command, index) => {
        const Icon = command.icon;

        return (
          <button
            aria-label={command.label}
            className={index === activeIndex ? "active" : ""}
            key={command.type}
            onClick={() => onSelect(command.type)}
            role="menuitem"
            type="button"
          >
            <Icon aria-hidden="true" size={15} />
            <span>{command.label}</span>
          </button>
        );
      })}
    </div>
  );
}
