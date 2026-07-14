import { Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { WorkspaceActivity } from "../../model/workspaceOperations";

interface ActivityDialogProps {
  activities: WorkspaceActivity[];
  onClose: () => void;
  onSelectActivity: (activity: WorkspaceActivity) => void;
}

export function ActivityDialog({ activities, onClose, onSelectActivity }: ActivityDialogProps) {
  return (
    <Dialog defaultOpen modal={false} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="grid max-h-[min(680px,calc(100dvh-2rem))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-xl"
        onCloseAutoFocus={(event) => event.preventDefault()}
        showOverlay={false}
      >
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>最近动态</DialogTitle>
          <DialogDescription>
            <span>协作动态</span>
            <span aria-hidden="true"> · </span>
            <span>{activities.length} 条工作区更新</span>
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0">
          <div className="grid gap-1 p-2">
            {activities.length > 0 ? (
              activities.map((activity) => (
                <Button
                  aria-label={`打开动态 ${activity.title}${activity.title === activity.documentTitle ? "" : ` ${activity.documentTitle}`}`}
                  className="h-auto w-full justify-start whitespace-normal px-3 py-3 text-left"
                  key={activity.id}
                  onClick={() => onSelectActivity(activity)}
                  type="button"
                  variant="ghost"
                >
                  <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold">
                    {activity.actor.slice(0, 1)}
                  </span>
                  <span className="grid min-w-0 flex-1 gap-1">
                    <span className="flex items-center justify-between gap-3">
                      <strong className="truncate text-sm font-medium">{activity.title}</strong>
                      <small className="shrink-0 text-xs font-normal text-muted-foreground">{activity.time}</small>
                    </span>
                    <span className="truncate text-xs font-normal text-muted-foreground">
                      {activity.actor} · {activity.action} · {activity.documentTitle}
                    </span>
                  </span>
                </Button>
              ))
            ) : (
              <div className="grid justify-items-center gap-2 py-14 text-center">
                <Clock3 aria-hidden="true" className="size-5 text-muted-foreground" />
                <strong className="text-sm">暂无动态</strong>
                <span className="text-xs text-muted-foreground">编辑文档、更新任务或添加评论后，会在这里汇总。</span>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
