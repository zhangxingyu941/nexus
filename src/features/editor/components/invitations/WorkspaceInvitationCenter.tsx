"use client";

import { LoaderCircle, Mail } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { ReceivedWorkspaceInvite } from "@/shared/workspaceInvites";

interface WorkspaceInvitationCenterProps {
  invites: ReceivedWorkspaceInvite[];
  onAccept: (inviteId: string) => Promise<void>;
  onDecline: (inviteId: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

type InviteAction = "accept" | "decline";

const ROLE_LABELS: Record<ReceivedWorkspaceInvite["role"], string> = {
  editor: "可编辑",
  viewer: "只读",
};

export function WorkspaceInvitationCenter({
  invites,
  onAccept,
  onDecline,
  onOpenChange,
  open,
}: WorkspaceInvitationCenterProps) {
  const [pendingActions, setPendingActions] = useState<Record<string, InviteAction>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function runAction(invite: ReceivedWorkspaceInvite, action: InviteAction) {
    if (pendingActions[invite.id]) {
      return;
    }
    if (action === "decline"
      && !window.confirm(`确定拒绝“${invite.workspaceName}”的工作区邀请吗？`)) {
      return;
    }

    setPendingActions((current) => ({ ...current, [invite.id]: action }));
    setErrors((current) => {
      const next = { ...current };
      delete next[invite.id];
      return next;
    });

    try {
      await (action === "accept" ? onAccept(invite.id) : onDecline(invite.id));
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [invite.id]: error instanceof Error && error.message ? error.message : "邀请操作失败",
      }));
    } finally {
      setPendingActions((current) => {
        const next = { ...current };
        delete next[invite.id];
        return next;
      });
    }
  }

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="w-full max-w-none gap-0 p-0 sm:max-w-[420px]">
        <SheetHeader className="border-b pr-12 text-left">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary">
              <Mail className="size-4" />
            </span>
            <SheetTitle>工作区邀请</SheetTitle>
          </div>
          <SheetDescription>{invites.length} 个待处理</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {invites.length === 0 ? (
            <div className="grid justify-items-center gap-2 py-16 text-center">
              <Mail aria-hidden="true" className="size-6 text-muted-foreground" />
              <strong className="text-sm font-medium">暂无待处理邀请</strong>
              <p className="m-0 max-w-xs text-xs leading-5 text-muted-foreground">
                新的工作区邀请会显示在这里。
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {invites.map((invite) => {
                const action = pendingActions[invite.id];
                return (
                  <article className="grid gap-4 rounded-md border bg-card p-4" key={invite.id}>
                    <div className="grid min-w-0 gap-2">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <h3 className="min-w-0 truncate text-sm font-semibold">{invite.workspaceName}</h3>
                        <Badge variant={invite.role === "editor" ? "success" : "outline"}>
                          {ROLE_LABELS[invite.role]}
                        </Badge>
                      </div>
                      <p className="m-0 text-xs leading-5 text-muted-foreground">
                        {invite.invitedBy.displayName} 邀请你加入，发送至 {invite.maskedEmail}
                      </p>
                      <span className="text-xs text-muted-foreground">
                        {formatExpiry(invite.expiresAt)}到期
                      </span>
                    </div>

                    {errors[invite.id] ? (
                      <p className="m-0 text-xs text-destructive" role="alert">{errors[invite.id]}</p>
                    ) : null}

                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <Button
                        aria-label="拒绝"
                        disabled={Boolean(action)}
                        onClick={() => void runAction(invite, "decline")}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {action === "decline" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
                        {action === "decline" ? "正在拒绝" : "拒绝"}
                      </Button>
                      <Button
                        aria-label="接受并进入"
                        disabled={Boolean(action)}
                        onClick={() => void runAction(invite, "accept")}
                        size="sm"
                        type="button"
                      >
                        {action === "accept" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : null}
                        {action === "accept" ? "正在接受" : "接受并进入"}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function formatExpiry(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    month: "long",
  }).format(new Date(timestamp));
}
