import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Block, BlockStatus } from "../../model/block";
import { DUE_DATE_OPTIONS, STATUS_OPTIONS } from "./blockMenuOptions";

interface BlockCollabPopoverProps {
  block: Block;
  onChangeAssignee: (blockId: string, assignee: string) => void;
  onChangeDueDate: (blockId: string, dueDate: string) => void;
  onChangeStatus: (blockId: string, status: BlockStatus) => void;
}

export function BlockCollabPopover({
  block,
  onChangeAssignee,
  onChangeDueDate,
  onChangeStatus,
}: BlockCollabPopoverProps) {
  return (
    <div aria-label="块协作属性" className="grid gap-3 p-3" role="dialog">
      <div className="grid gap-0.5">
        <strong className="text-sm font-semibold">块协作属性</strong>
        <span className="text-xs text-muted-foreground">给当前块分配负责人和状态</span>
      </div>
      <div className="grid grid-cols-2 gap-1" aria-label="块状态">
        {STATUS_OPTIONS.map((status) => (
          <Button
            aria-pressed={block.status === status.value}
            className={cn("h-8 justify-start px-2 text-xs", block.status === status.value && "border-primary/30 bg-accent text-accent-foreground")}
            key={status.value}
            onClick={() => onChangeStatus(block.id, status.value)}
            size="sm"
            type="button"
            variant="outline"
          >
            {status.label}
          </Button>
        ))}
      </div>
      <label className="grid gap-1.5 text-xs font-medium text-foreground">
        <span>负责人</span>
        <Input
          aria-label="负责人"
          className="h-8 text-xs"
          onChange={(event) => onChangeAssignee(block.id, event.target.value)}
          placeholder="输入负责人"
          value={block.assignee}
        />
      </label>
      <div className="flex flex-wrap gap-1" aria-label="截止时间">
        {DUE_DATE_OPTIONS.map((dueDate) => (
          <Button
            aria-pressed={block.dueDate === dueDate}
            className={cn("h-7 px-2 text-[11px]", block.dueDate === dueDate && "bg-secondary text-secondary-foreground")}
            key={dueDate}
            onClick={() => onChangeDueDate(block.id, dueDate)}
            size="sm"
            type="button"
            variant="outline"
          >
            {dueDate}
          </Button>
        ))}
      </div>
    </div>
  );
}
