import {
  ArrowDown,
  ArrowUp,
  Code2,
  GripVertical,
  Heading1,
  IndentDecrease,
  IndentIncrease,
  ListTodo,
  Plus,
  Quote,
  Trash2,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BlockType, MoveDirection } from "../../model/block";

interface BlockControlsProps {
  blockId: string;
  canIndent: boolean;
  canOutdent: boolean;
  isFirst: boolean;
  isLast: boolean;
  isMenuOpen: boolean;
  onAddAfter: (blockId: string) => void;
  onChangeType: (type: BlockType) => void;
  onDelete: () => void;
  onIndent: () => void;
  onMenuOpenChange: (open: boolean) => void;
  onMove: (direction: MoveDirection) => void;
  onOutdent: () => void;
}

export function BlockControls({
  blockId,
  canIndent,
  canOutdent,
  isFirst,
  isLast,
  isMenuOpen,
  onAddAfter,
  onChangeType,
  onDelete,
  onIndent,
  onMenuOpenChange,
  onMove,
  onOutdent,
}: BlockControlsProps) {
  return (
    <div aria-label="块操作" className="block-controls">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="在下方添加块"
            className="block-gutter-button size-7 text-muted-foreground"
            onClick={() => onAddAfter(blockId)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Plus aria-hidden="true" className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">添加块</TooltipContent>
      </Tooltip>
      <DropdownMenu open={isMenuOpen} onOpenChange={onMenuOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="打开块菜单"
                className="block-gutter-button size-7 text-muted-foreground"
                size="icon"
                type="button"
                variant={isMenuOpen ? "secondary" : "ghost"}
              >
                <GripVertical aria-hidden="true" className="size-4" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="left">块菜单</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" aria-label="块菜单" className="w-44" side="right">
          <DropdownMenuItem aria-label="转为段落" onSelect={() => onChangeType("paragraph")}>
            <Type aria-hidden="true" size={15} />
            <span>转为段落</span>
          </DropdownMenuItem>
          <DropdownMenuItem aria-label="转为标题" onSelect={() => onChangeType("heading")}>
            <Heading1 aria-hidden="true" size={15} />
            <span>转为标题</span>
          </DropdownMenuItem>
          <DropdownMenuItem aria-label="转为待办" onSelect={() => onChangeType("todo")}>
            <ListTodo aria-hidden="true" size={15} />
            <span>转为待办</span>
          </DropdownMenuItem>
          <DropdownMenuItem aria-label="转为引用" onSelect={() => onChangeType("quote")}>
            <Quote aria-hidden="true" size={15} />
            <span>转为引用</span>
          </DropdownMenuItem>
          <DropdownMenuItem aria-label="转为代码" onSelect={() => onChangeType("code")}>
            <Code2 aria-hidden="true" size={15} />
            <span>转为代码</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem aria-label="缩进块" disabled={!canIndent} onSelect={onIndent}>
            <IndentIncrease aria-hidden="true" size={15} />
            <span>缩进块</span>
          </DropdownMenuItem>
          <DropdownMenuItem aria-label="取消缩进" disabled={!canOutdent} onSelect={onOutdent}>
            <IndentDecrease aria-hidden="true" size={15} />
            <span>取消缩进</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem aria-label="上移块" disabled={isFirst} onSelect={() => onMove("up")}>
            <ArrowUp aria-hidden="true" size={15} />
            <span>上移块</span>
          </DropdownMenuItem>
          <DropdownMenuItem aria-label="下移块" disabled={isLast} onSelect={() => onMove("down")}>
            <ArrowDown aria-hidden="true" size={15} />
            <span>下移块</span>
          </DropdownMenuItem>
          <DropdownMenuItem aria-label="删除块" onSelect={onDelete} variant="destructive">
            <Trash2 aria-hidden="true" size={15} />
            <span>删除块</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
