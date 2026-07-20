"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { useState } from "react";
import type { WorkspaceDeletionSummary } from "../../../../../shared/workspaceLifecycle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface WorkspaceDangerZoneProps {
  summary: WorkspaceDeletionSummary;
  isDeleting?: boolean;
  onDelete: (confirmationName: string) => Promise<void>;
}

export function WorkspaceDangerZone({
  summary,
  isDeleting = false,
  onDelete,
}: WorkspaceDangerZoneProps) {
  const [confirmationName, setConfirmationName] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isDeletingLocally, setIsDeletingLocally] = useState(false);
  const [error, setError] = useState("");
  const canDelete = confirmationName === summary.name && !isDeleting && !isDeletingLocally;

  const deleteWorkspace = async () => {
    if (!canDelete) return;
    setIsDeletingLocally(true);
    setError("");
    try {
      await onDelete(confirmationName);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移至回收站失败");
    } finally {
      setIsDeletingLocally(false);
    }
  };

  return (
    <section aria-label="危险区域" className="grid gap-4 border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="grid gap-1">
          <h3 className="text-sm font-semibold">危险区域</h3>
          <p className="text-sm text-muted-foreground">移除后将保留 7 天，期间可从回收站恢复。</p>
        </div>
      </div>
      <dl className="grid grid-cols-3 divide-x border-y py-3 text-center">
        <div className="grid gap-1 px-2"><dt className="text-xs text-muted-foreground">文档</dt><dd className="text-sm font-semibold">{summary.documentCount} 个文档</dd></div>
        <div className="grid gap-1 px-2"><dt className="text-xs text-muted-foreground">成员</dt><dd className="text-sm font-semibold">{summary.memberCount} 名成员</dd></div>
        <div className="grid gap-1 px-2"><dt className="text-xs text-muted-foreground">文件</dt><dd className="text-sm font-semibold">{summary.fileCount} 个文件</dd></div>
      </dl>
      <Dialog onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) {
          setConfirmationName("");
          setError("");
        }
      }} open={isOpen}>
        <DialogTrigger asChild>
          <Button disabled={isDeleting} type="button" variant="destructive">
            <Trash2 aria-hidden="true" className="size-4" />移至回收站
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移至回收站</DialogTitle>
            <DialogDescription>
              将“{summary.name}”移至回收站。{summary.documentCount} 个文档、{summary.memberCount} 名成员和 {summary.fileCount} 个文件会保留 7 天。
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm font-medium">
            输入完整工作区名称以确认
            <Input
              aria-label="输入完整工作区名称以确认"
              autoComplete="off"
              onChange={(event) => setConfirmationName(event.target.value)}
              value={confirmationName}
            />
          </label>
          {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button onClick={() => setIsOpen(false)} type="button" variant="outline">取消</Button>
            <Button disabled={!canDelete} onClick={() => void deleteWorkspace()} type="button" variant="destructive">
              <Trash2 aria-hidden="true" className="size-4" />{isDeletingLocally || isDeleting ? "移至回收站中..." : "移至回收站"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
