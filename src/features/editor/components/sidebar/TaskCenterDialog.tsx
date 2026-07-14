import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WorkspaceTask, WorkspaceTaskGroup } from "../../model/workspaceOperations";
import { TASK_STATUS_LABELS } from "./sidebarUtils";
import type { TaskStatusFilter } from "./sidebarUtils";

interface TaskCenterDialogProps {
  assignees: string[];
  assigneeFilter: string;
  groups: WorkspaceTaskGroup[];
  isReadOnly: boolean;
  statusFilter: TaskStatusFilter;
  taskCount: number;
  onChangeAssigneeFilter: (assignee: string) => void;
  onChangeStatusFilter: (status: TaskStatusFilter) => void;
  onClose: () => void;
  onCompleteTask: (documentId: string, blockId: string) => void;
  onSelectTask: (task: WorkspaceTask) => void;
}

export function TaskCenterDialog({
  assignees,
  assigneeFilter,
  groups,
  isReadOnly,
  statusFilter,
  taskCount,
  onChangeAssigneeFilter,
  onChangeStatusFilter,
  onClose,
  onCompleteTask,
  onSelectTask,
}: TaskCenterDialogProps) {
  return (
    <Dialog defaultOpen modal={false} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="grid h-[min(760px,calc(100dvh-2rem))] grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-3xl"
        onCloseAutoFocus={(event) => event.preventDefault()}
        showOverlay={false}
      >
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>任务中心</DialogTitle>
          <DialogDescription className="flex gap-2">
            <span>{taskCount} 个行动项</span>
            <span>跨文档汇总</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 border-b p-4 sm:grid-cols-[minmax(0,1fr)_150px] sm:items-end">
          <Tabs className="min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" value={statusFilter} onValueChange={(value) => onChangeStatusFilter(value as TaskStatusFilter)}>
            <TabsList aria-label="任务状态筛选" className="grid h-9 w-full min-w-[448px] grid-cols-7">
              {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
                <TabsTrigger className="min-w-0 px-1 text-xs after:hidden sm:px-2" key={value} value={value}>{label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <label className="grid gap-1.5 text-xs font-medium text-foreground">
            <span>负责人</span>
            <select
              aria-label="负责人筛选"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
              onChange={(event) => onChangeAssigneeFilter(event.target.value)}
              value={assigneeFilter}
            >
              <option value="all">全部</option>
              {assignees.map((assignee) => (
                <option key={assignee} value={assignee}>{assignee}</option>
              ))}
            </select>
          </label>
        </div>

        <ScrollArea className="min-h-0">
          <div className="grid gap-5 p-4">
            {groups.length > 0 ? (
              groups.map((group) => (
                <section className="grid gap-2" key={group.id}>
                  <div className="task-due-heading flex items-center justify-between border-b pb-2 text-sm">
                    <strong>{group.label}</strong>
                    <span className="text-xs text-muted-foreground">{group.tasks.length} 项</span>
                  </div>
                  {group.tasks.map((task) => (
                    <div className="flex items-center gap-2 rounded-md border p-2" key={task.id}>
                      <Button
                        aria-label={`打开任务 ${task.content}`}
                        className="h-auto min-w-0 flex-1 justify-start whitespace-normal px-2 py-1.5 text-left"
                        onClick={() => onSelectTask(task)}
                        type="button"
                        variant="ghost"
                      >
                        <span className={`task-status-dot task-status-${task.status}`} />
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <strong className="truncate text-sm font-medium">{task.content}</strong>
                          <small className="truncate text-xs font-normal text-muted-foreground">
                            {task.documentTitle} · {TASK_STATUS_LABELS[task.status]}
                          </small>
                        </span>
                        <span className="grid shrink-0 justify-items-end gap-1 text-xs font-normal text-muted-foreground">
                          <span>{task.assignee}</span>
                          <small>{task.dueDate}</small>
                        </span>
                      </Button>
                      {task.status === "done" ? (
                        <Badge variant="success">已完成</Badge>
                      ) : !isReadOnly ? (
                        <Button
                          aria-label={`标记完成 ${task.content}`}
                          className="shrink-0"
                          onClick={() => onCompleteTask(task.documentId, task.blockId)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          标记完成
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </section>
              ))
            ) : (
              <div className="grid justify-items-center gap-2 py-16 text-center">
                <CheckCircle2 aria-hidden="true" className="size-5 text-muted-foreground" />
                <strong className="text-sm">暂无行动项</strong>
                <span className="max-w-sm text-xs leading-5 text-muted-foreground">给正文块设置负责人、状态或截止时间后，会自动汇总到这里。</span>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
