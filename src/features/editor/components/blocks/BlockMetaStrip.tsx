import { CalendarDays, MessageSquare, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Block } from "../../model/block";
import { getStatusLabel } from "./blockMenuOptions";

interface BlockMetaStripProps {
  block: Block;
}

export function BlockMetaStrip({ block }: BlockMetaStripProps) {
  const openCommentCount = block.comments.filter((comment) => !comment.resolved).length;
  const statusVariant = block.status === "done" ? "success" : block.status === "in-progress" || block.status === "review" ? "warning" : "outline";

  if (!block.assignee && !block.dueDate && block.status === "unset" && block.comments.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {block.status !== "unset" ? (
        <Badge variant={statusVariant}>
          {getStatusLabel(block.status)}
        </Badge>
      ) : null}
      {block.assignee ? (
        <Badge className="gap-1 font-normal" variant="outline">
          <UserRound aria-hidden="true" className="size-3" />
          {block.assignee}
        </Badge>
      ) : null}
      {block.dueDate ? (
        <Badge className="gap-1 font-normal" variant="outline">
          <CalendarDays aria-hidden="true" className="size-3" />
          {block.dueDate}
        </Badge>
      ) : null}
      {openCommentCount > 0 ? (
        <Badge className="gap-1 font-normal" variant="warning">
          <MessageSquare aria-hidden="true" className="size-3" />
          {openCommentCount} 条待处理
        </Badge>
      ) : null}
    </div>
  );
}
