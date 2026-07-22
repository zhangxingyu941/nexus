import { Bold, Code2, Italic, Link2, MessageSquare, Strikethrough } from "lucide-react";
import type { CSSProperties, MouseEvent } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface SelectionToolbarProps {
  activeMarks: {
    bold: boolean;
    code: boolean;
    italic: boolean;
    link: boolean;
    strike: boolean;
  };
  anchor: { left: number; top: number } | null;
  onBold: () => void;
  onCode: () => void;
  onComment?: () => void;
  onItalic: () => void;
  onLink: () => void;
  onStrike: () => void;
}

interface ToolbarActionProps {
  active?: boolean;
  icon: typeof Bold;
  label: string;
  onClick: () => void;
}

function ToolbarAction({ active = false, icon: Icon, label, onClick }: ToolbarActionProps) {
  const keepEditorSelection = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          aria-pressed={active}
          className="selection-toolbar-button"
          data-active={active ? "true" : "false"}
          onClick={onClick}
          onPointerDown={keepEditorSelection}
          type="button"
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export function SelectionToolbar({
  activeMarks,
  anchor,
  onBold,
  onCode,
  onComment,
  onItalic,
  onLink,
  onStrike,
}: SelectionToolbarProps) {
  if (!anchor) {
    return null;
  }

  const style: CSSProperties = {
    left: `clamp(136px, ${anchor.left}px, calc(100vw - 136px))`,
    top: anchor.top,
    transform: "translate(-50%, -100%)",
  };

  return (
    <div
      aria-label="Text formatting"
      className="selection-toolbar"
      role="toolbar"
      style={style}
    >
      <ToolbarAction active={activeMarks.bold} icon={Bold} label="Bold" onClick={onBold} />
      <ToolbarAction active={activeMarks.italic} icon={Italic} label="Italic" onClick={onItalic} />
      <ToolbarAction active={activeMarks.strike} icon={Strikethrough} label="Strikethrough" onClick={onStrike} />
      <ToolbarAction active={activeMarks.code} icon={Code2} label="Code" onClick={onCode} />
      <span aria-hidden="true" className="selection-toolbar-divider" />
      <ToolbarAction active={activeMarks.link} icon={Link2} label="Link" onClick={onLink} />
      {onComment ? <ToolbarAction icon={MessageSquare} label="Comment" onClick={onComment} /> : null}
    </div>
  );
}
