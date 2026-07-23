import {
  ArrowDown,
  ArrowUp,
  Code2,
  CheckSquare,
  GripVertical,
  Heading1,
  IndentDecrease,
  IndentIncrease,
  ListTodo,
  MoreHorizontal,
  Plus,
  Quote,
  Trash2,
  Type,
} from "lucide-react";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { useEffect, useRef, type MouseEvent, type PointerEvent, type RefCallback } from "react";
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
import type { BlockSelectionMode } from "../../model/blockSelection";

interface BlockControlsProps {
  blockId: string;
  canIndent: boolean;
  canOutdent: boolean;
  dragHandleAttributes?: DraggableAttributes;
  dragHandleListeners?: DraggableSyntheticListeners;
  dragHandleRef?: RefCallback<HTMLButtonElement>;
  isFirst: boolean;
  isLast: boolean;
  isMenuOpen: boolean;
  isReadOnly?: boolean;
  isSelected?: boolean;
  isSelectionActive?: boolean;
  onAddAfter: (blockId: string) => void;
  onChangeType: (type: BlockType) => void;
  onDelete: () => void;
  onIndent: () => void;
  onMenuOpenChange: (open: boolean) => void;
  onMove: (direction: MoveDirection) => void;
  onOutdent: () => void;
  onSelect?: (mode: BlockSelectionMode) => void;
}

export function BlockControls({
  blockId,
  canIndent,
  canOutdent,
  dragHandleAttributes,
  dragHandleListeners,
  dragHandleRef,
  isFirst,
  isLast,
  isMenuOpen,
  isReadOnly = false,
  isSelected = false,
  isSelectionActive = false,
  onAddAfter,
  onChangeType,
  onDelete,
  onIndent,
  onMenuOpenChange,
  onMove,
  onOutdent,
  onSelect,
}: BlockControlsProps) {
  const touchSelectionTimerRef = useRef<number | null>(null);
  const touchSelectionActiveRef = useRef(false);
  const touchLongPressRef = useRef(false);

  const clearTouchSelectionTimer = () => {
    if (touchSelectionTimerRef.current !== null) {
      window.clearTimeout(touchSelectionTimerRef.current);
      touchSelectionTimerRef.current = null;
    }
  };

  useEffect(() => clearTouchSelectionTimer, []);

  const handleSelectPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType !== "touch") {
      return;
    }

    touchSelectionActiveRef.current = true;
    touchLongPressRef.current = false;
    if (isSelectionActive) {
      return;
    }

    clearTouchSelectionTimer();
    touchSelectionTimerRef.current = window.setTimeout(() => {
      touchSelectionTimerRef.current = null;
      touchLongPressRef.current = true;
      onSelect?.("replace");
    }, 180);
  };

  const handleSelectPointerEnd = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch") {
      clearTouchSelectionTimer();
    }
  };

  const handleSelectClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (touchSelectionActiveRef.current) {
      touchSelectionActiveRef.current = false;
      if (touchLongPressRef.current) {
        touchLongPressRef.current = false;
        return;
      }
      if (isSelectionActive) {
        onSelect?.("toggle");
      }
      return;
    }

    onSelect?.(event.shiftKey ? "range" : event.ctrlKey || event.metaKey ? "toggle" : "replace");
  };

  return (
    <div aria-label="块操作" className="block-controls">
      {onSelect ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={`选择块 ${blockId}`}
              aria-pressed={isSelected}
              className="block-gutter-button size-7 text-muted-foreground"
              onClick={handleSelectClick}
              onPointerCancel={handleSelectPointerEnd}
              onPointerDown={handleSelectPointerDown}
              onPointerUp={handleSelectPointerEnd}
              size="icon"
              type="button"
              variant={isSelected ? "secondary" : "ghost"}
            >
              <CheckSquare aria-hidden="true" className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">选择块</TooltipContent>
        </Tooltip>
      ) : null}
      {!isReadOnly && dragHandleListeners ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              {...dragHandleAttributes}
              {...dragHandleListeners}
              aria-label="拖动块"
              className="block-gutter-button size-7 cursor-grab text-muted-foreground active:cursor-grabbing"
              ref={dragHandleRef}
              size="icon"
              type="button"
              variant="ghost"
            >
              <GripVertical aria-hidden="true" className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">拖动块</TooltipContent>
        </Tooltip>
      ) : null}
      {!isReadOnly ? <Tooltip>
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
      </Tooltip> : null}
      {!isReadOnly ? <DropdownMenu open={isMenuOpen} onOpenChange={onMenuOpenChange}>
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
                <MoreHorizontal aria-hidden="true" className="size-4" />
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
      </DropdownMenu> : null}
    </div>
  );
}
