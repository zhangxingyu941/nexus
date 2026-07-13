import { Check, Link2, Lock, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WorkspaceCollaborator } from "../../model/workspaceOperations";
import type { SharePermission } from "./documentEditorTypes";

const SHARE_OPTIONS: Array<{
  icon: typeof Users;
  label: string;
  value: SharePermission;
}> = [
  { icon: Lock, label: "私有", value: "private" },
  { icon: Users, label: "团队可查看", value: "team" },
  { icon: Link2, label: "拥有链接的人可查看", value: "link" },
];

interface SharePopoverProps {
  collaborators: WorkspaceCollaborator[];
  documentId: string;
  sharePermission: SharePermission;
  shareStatus: string;
  onChangePermission: (permission: SharePermission) => void;
  onClose: () => void;
  onCopyLink: () => void;
}

export function SharePopover({
  collaborators,
  documentId,
  sharePermission,
  shareStatus,
  onChangePermission,
  onClose,
  onCopyLink,
}: SharePopoverProps) {
  return (
    <Dialog defaultOpen onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>分享文档</DialogTitle>
          <DialogDescription>设置谁可以访问当前文档。</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {SHARE_OPTIONS.map((option) => {
            const Icon = option.icon;

            return (
              <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted has-[:checked]:border-foreground/30 has-[:checked]:bg-muted" key={option.value}>
                <input
                  checked={sharePermission === option.value}
                  className="size-4 accent-zinc-900"
                  name="share-permission"
                  onChange={() => onChangePermission(option.value)}
                  type="radio"
                />
                <span aria-hidden="true" className="grid size-8 place-items-center rounded-md bg-background text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <span className="flex-1">{option.label}</span>
                {sharePermission === option.value ? <Check aria-hidden="true" className="size-4" /> : null}
              </label>
            );
          })}
        </div>

        <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/50 p-2">
          <span className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground">{`${window.location.origin}/documents/${documentId}`}</span>
          <Button className="h-8 shrink-0" onClick={onCopyLink} size="sm" type="button">复制链接</Button>
        </div>
        <div className="grid gap-1 rounded-md border p-3">
          <strong className="text-sm font-medium">已有 {collaborators.length} 位成员可访问</strong>
          <span className="text-xs text-muted-foreground">{sharePermission === "private" ? "当前仅邀请成员可见" : "团队成员可以通过工作区入口访问"}</span>
        </div>
        {shareStatus ? <Badge aria-live="polite" variant="success">{shareStatus}</Badge> : null}
      </DialogContent>
    </Dialog>
  );
}
