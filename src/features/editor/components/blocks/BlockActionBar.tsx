import { MessageSquare, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getBlockCommandLabel } from "../../commands/editorCommands";
import type { Block } from "../../model/block";

interface BlockActionBarProps {
  block: Block;
  collabContent: ReactNode;
  commentsContent: ReactNode;
  isReadOnly: boolean;
  isCollabOpen: boolean;
  isCommentsOpen: boolean;
  onCollabOpenChange: (open: boolean) => void;
  onCommentsOpenChange: (open: boolean) => void;
}

export function BlockActionBar({
  block,
  collabContent,
  commentsContent,
  isReadOnly,
  isCollabOpen,
  isCommentsOpen,
  onCollabOpenChange,
  onCommentsOpenChange,
}: BlockActionBarProps) {
  return (
    <div aria-label="当前块操作" className="block-action-bar" role="toolbar">
      <span className="block-action-type">
        {getBlockCommandLabel(block.type, block.headingLevel)}
      </span>
      {!isReadOnly ? (
        <Popover open={isCollabOpen} onOpenChange={onCollabOpenChange}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  aria-label="打开块协作属性"
                  className="size-7 text-muted-foreground"
                  size="icon"
                  type="button"
                  variant={isCollabOpen ? "secondary" : "ghost"}
                >
                  <UserRound aria-hidden="true" className="size-3.5" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>协作属性</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-[300px] p-0">{collabContent}</PopoverContent>
        </Popover>
      ) : null}
      <Popover open={isCommentsOpen} onOpenChange={onCommentsOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                aria-label="打开块评论"
                className="size-7 text-muted-foreground"
                size="icon"
                type="button"
                variant={isCommentsOpen ? "secondary" : "ghost"}
              >
                <MessageSquare aria-hidden="true" className="size-3.5" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>块评论</TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="w-[340px] max-w-[calc(100vw-2rem)] p-0">
          {commentsContent}
        </PopoverContent>
      </Popover>
    </div>
  );
}
