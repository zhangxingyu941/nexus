import {
  Bold,
  Code2,
  Copy,
  CopyPlus,
  Heading1,
  IndentDecrease,
  IndentIncrease,
  Italic,
  ListTodo,
  Quote,
  Scissors,
  Strikethrough,
  Trash2,
  Type,
} from "lucide-react";
import type { CSSProperties, MouseEvent } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BlockType } from "../model/block";

export type BlockSelectionToolbarAction =
  | "bold"
  | "copy"
  | "cut"
  | "duplicate"
  | "delete"
  | "indent"
  | "italic"
  | "outdent"
  | "code"
  | "strike";

interface BlockSelectionToolbarProps {
  anchor: { left: number; top: number } | null;
  isReadOnly: boolean;
  onAction: (action: BlockSelectionToolbarAction) => void;
  onChangeType?: (type: BlockType) => void;
  selectedCount: number;
}

interface ToolbarActionProps {
  action: BlockSelectionToolbarAction;
  icon: typeof Bold;
  label: string;
  onAction: (action: BlockSelectionToolbarAction) => void;
}

function ToolbarAction({ action, icon: Icon, label, onAction }: ToolbarActionProps) {
  const keepBlockSelection = (event: MouseEvent<HTMLButtonElement>) => event.preventDefault();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          className="block-selection-toolbar-button"
          onClick={() => onAction(action)}
          onPointerDown={keepBlockSelection}
          type="button"
        >
          <Icon aria-hidden="true" size={16} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

export function BlockSelectionToolbar({
  anchor,
  isReadOnly,
  onAction,
  onChangeType,
  selectedCount,
}: BlockSelectionToolbarProps) {
  if (!anchor || selectedCount === 0) {
    return null;
  }

  const style: CSSProperties = {
    left: `clamp(160px, ${anchor.left}px, calc(100vw - 160px))`,
    top: Math.max(anchor.top, 44),
  };

  return (
    <div
      aria-label="批量块操作"
      className="block-selection-toolbar"
      role="toolbar"
      style={style}
    >
      <span aria-live="polite" className="block-selection-toolbar-count" role="status">
        已选择 {selectedCount} 个块
      </span>
      <ToolbarAction action="copy" icon={Copy} label="复制所选块" onAction={onAction} />
      {isReadOnly ? null : (
        <>
          <ToolbarAction action="cut" icon={Scissors} label="剪切所选块" onAction={onAction} />
          <ToolbarAction action="duplicate" icon={CopyPlus} label="复制块" onAction={onAction} />
          {onChangeType ? (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label="转换所选块类型"
                      className="block-selection-toolbar-button"
                      type="button"
                    >
                      <Type aria-hidden="true" size={16} />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="top">转换所选块类型</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="center" aria-label="批量转换块类型" side="top">
                <DropdownMenuItem aria-label="转换为段落" onSelect={() => onChangeType("paragraph")}>
                  <Type aria-hidden="true" size={15} />
                  <span>转换为段落</span>
                </DropdownMenuItem>
                <DropdownMenuItem aria-label="转换为标题" onSelect={() => onChangeType("heading")}>
                  <Heading1 aria-hidden="true" size={15} />
                  <span>转换为标题</span>
                </DropdownMenuItem>
                <DropdownMenuItem aria-label="转换为待办" onSelect={() => onChangeType("todo")}>
                  <ListTodo aria-hidden="true" size={15} />
                  <span>转换为待办</span>
                </DropdownMenuItem>
                <DropdownMenuItem aria-label="转换为引用" onSelect={() => onChangeType("quote")}>
                  <Quote aria-hidden="true" size={15} />
                  <span>转换为引用</span>
                </DropdownMenuItem>
                <DropdownMenuItem aria-label="转换为代码" onSelect={() => onChangeType("code")}>
                  <Code2 aria-hidden="true" size={15} />
                  <span>转换为代码</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <ToolbarAction action="delete" icon={Trash2} label="删除所选块" onAction={onAction} />
          <span aria-hidden="true" className="block-selection-toolbar-divider" />
          <ToolbarAction action="outdent" icon={IndentDecrease} label="减少所选块缩进" onAction={onAction} />
          <ToolbarAction action="indent" icon={IndentIncrease} label="增加所选块缩进" onAction={onAction} />
          <span aria-hidden="true" className="block-selection-toolbar-divider" />
          <ToolbarAction action="bold" icon={Bold} label="加粗所选块" onAction={onAction} />
          <ToolbarAction action="italic" icon={Italic} label="斜体所选块" onAction={onAction} />
          <ToolbarAction action="strike" icon={Strikethrough} label="删除线所选块" onAction={onAction} />
          <ToolbarAction action="code" icon={Code2} label="行内代码所选块" onAction={onAction} />
        </>
      )}
    </div>
  );
}
