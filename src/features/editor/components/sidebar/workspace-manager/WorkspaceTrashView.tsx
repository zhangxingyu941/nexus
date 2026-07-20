"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import type { DeletedWorkspaceSummary } from "../../../../../shared/workspaceLifecycle";
import { Button } from "@/components/ui/button";

interface WorkspaceTrashViewProps {
  isRestoringId?: string | null;
  onRestore: (workspaceId: string) => Promise<void>;
  workspaces: DeletedWorkspaceSummary[];
}

export function WorkspaceTrashView({
  isRestoringId,
  onRestore,
  workspaces,
}: WorkspaceTrashViewProps) {
  if (workspaces.length === 0) {
    return (
      <section aria-label="回收站" className="grid place-items-center gap-2 py-12 text-center">
        <Trash2 aria-hidden="true" className="size-5 text-muted-foreground" />
        <p className="text-sm font-medium">回收站为空</p>
        <p className="text-sm text-muted-foreground">可恢复的工作区会显示在这里。</p>
      </section>
    );
  }

  return (
    <section aria-label="回收站" className="grid gap-3">
      {workspaces.map((workspace) => {
        const remaining = remainingTime(workspace.purgeAfter);
        const expired = remaining === null;
        const isRestoring = isRestoringId === workspace.id;
        return (
          <article className="grid gap-3 border-b py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid={`trashed-workspace-${workspace.id}`} key={workspace.id}>
            <div className="grid min-w-0 gap-1">
              <strong className="truncate text-sm font-medium">{workspace.name}</strong>
              <span className="text-xs text-muted-foreground">{formatDeletedAt(workspace.deletedAt)}</span>
              <span className="text-xs text-muted-foreground">{workspace.deletedBy ? `${workspace.deletedBy.displayName} 删除` : "未知用户删除"}</span>
              <span className={expired ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {expired ? "已过期" : `剩余 ${remaining}`}
              </span>
            </div>
            {!expired ? (
              <Button
                className="w-full sm:w-auto"
                disabled={isRestoring}
                onClick={() => void onRestore(workspace.id)}
                type="button"
                variant="outline"
              >
                <RotateCcw aria-hidden="true" className="size-4" />{isRestoring ? "恢复中..." : "恢复并进入"}
              </Button>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

function formatDeletedAt(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function remainingTime(purgeAfter: number) {
  const milliseconds = purgeAfter - Date.now();
  if (milliseconds <= 0) return null;

  const hours = Math.ceil(milliseconds / 3_600_000);
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days === 0) return `${remainingHours || 1} 小时`;
  return remainingHours === 0 ? `${days} 天` : `${days} 天 ${remainingHours} 小时`;
}
