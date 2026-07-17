import { X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { CollaborationPresence } from "../../collaboration/collaborationTypes";
import type { WorkspaceCollaborator } from "../../model/workspaceOperations";
import type { DatabaseWorkspaceMember, WorkspaceAccessRole } from "../../session/sessionTypes";

interface MembersPopoverProps {
  collaborators: WorkspaceCollaborator[];
  onlineCount: number;
  openCommentCount: number;
  presence: CollaborationPresence[];
  workspaceMembers?: DatabaseWorkspaceMember[];
  onClose: () => void;
}

const ROLE_LABELS: Record<WorkspaceAccessRole, string> = {
  editor: "可编辑",
  owner: "所有者",
  viewer: "只读",
};

export function MembersPopover({
  collaborators,
  onlineCount,
  openCommentCount,
  presence,
  workspaceMembers = [],
  onClose,
}: MembersPopoverProps) {
  return (
    <Sheet defaultOpen onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 p-0 sm:max-w-md" showCloseButton={false}>
        <section className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="flex-row items-start justify-between border-b text-left">
            <div className="grid gap-1">
              <SheetTitle>成员与协作</SheetTitle>
              <SheetDescription>{onlineCount} 人在线</SheetDescription>
            </div>
            <Button aria-label="关闭成员面板" className="size-8" onClick={onClose} size="icon" type="button" variant="ghost">
              <X aria-hidden="true" className="size-4" />
            </Button>
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="grid gap-5 p-4">
              <div className="grid grid-cols-3 divide-x rounded-md border text-center text-xs text-muted-foreground">
                <span className="grid gap-1 p-3"><strong className="text-lg text-foreground">{onlineCount}</strong>在线</span>
                <span className="grid gap-1 p-3"><strong className="text-lg text-foreground">{collaborators.reduce((total, collaborator) => total + collaborator.activeTaskCount, 0)}</strong>进行中任务</span>
                <span className="grid gap-1 p-3"><strong className="text-lg text-foreground">{openCommentCount}</strong>待处理评论</span>
              </div>

              {presence.length > 0 ? (
                <section aria-label="实时在线成员" className="grid gap-2" role="region">
                  <p className="text-xs font-medium text-muted-foreground">在线成员</p>
                  <div className="grid gap-1">
                    {presence.map((member) => (
                      <span className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted" key={member.clientId}>
                        <Avatar className="size-8"><AvatarFallback>{member.name.slice(0, 1)}</AvatarFallback></Avatar>
                        <span className="grid min-w-0">
                          <strong className="truncate text-sm font-medium">{member.name}</strong>
                          <small className="text-xs text-muted-foreground">{member.isLocal ? "当前窗口" : "协作窗口"}</small>
                        </span>
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              {workspaceMembers.length > 0 ? (
                <section aria-label="数据库工作区成员" className="grid gap-2" role="region">
                  <p className="text-xs font-medium text-muted-foreground">工作区权限</p>
                  <div className="grid gap-1">
                    {workspaceMembers.map((member) => (
                      <span className="flex items-center gap-3 rounded-md border px-3 py-2" key={member.id}>
                        <Avatar className="size-8"><AvatarFallback>{member.displayName.slice(0, 1)}</AvatarFallback></Avatar>
                        <span className="grid min-w-0 flex-1">
                          <strong className="truncate text-sm font-medium">{member.displayName}</strong>
                          <small className="truncate text-xs text-muted-foreground">{member.email}</small>
                        </span>
                        <Badge variant={member.role === "owner" ? "default" : member.role === "editor" ? "success" : "outline"}>{ROLE_LABELS[member.role]}</Badge>
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="grid gap-2">
                <p className="text-xs font-medium text-muted-foreground">协作成员</p>
                <div className="grid gap-1">
                  {collaborators.map((collaborator) => (
                    <Button aria-label={`查看成员 ${collaborator.name} ${collaborator.role}`} className="h-auto justify-start whitespace-normal px-2 py-2 text-left" key={collaborator.name} type="button" variant="ghost">
                      <Avatar className="size-8"><AvatarFallback>{collaborator.name.slice(0, 1)}</AvatarFallback></Avatar>
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <strong className="truncate text-sm font-medium">{collaborator.name}</strong>
                        <small className="truncate text-xs font-normal text-muted-foreground">
                          <span>{collaborator.role}</span>
                          <span aria-hidden="true"> · </span>
                          <span>正在编辑 {collaborator.activeDocumentTitle}</span>
                        </small>
                      </span>
                      <span className="grid shrink-0 justify-items-end gap-1 text-xs font-normal text-muted-foreground">
                        <Badge variant="outline">{collaborator.status === "unknown" ? "未在线" : collaborator.status === "away" ? "离开" : collaborator.status === "editing" ? "编辑中" : "在线"}</Badge>
                        <small>{collaborator.activeTaskCount} 个任务</small>
                        <small>{collaborator.openCommentCount} 条待处理评论</small>
                      </span>
                    </Button>
                  ))}
                </div>
              </section>
            </div>
          </ScrollArea>
        </section>
      </SheetContent>
    </Sheet>
  );
}
