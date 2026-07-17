"use client";

import { MoreHorizontal, UserMinus, ArrowRightLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WorkspaceRole } from "../../../../../shared/workspace";
import {
  leaveWorkspace,
  loadWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from "../../../persistence/workspaceMemberRepository";
import type { DatabaseWorkspaceMember, WorkspaceAccessRole } from "../../../session/sessionTypes";

const ROLE_LABELS: Record<WorkspaceAccessRole, string> = {
  editor: "编辑者",
  owner: "所有者",
  viewer: "访客",
};

const EDITABLE_ROLES: WorkspaceRole[] = ["editor", "viewer"];

interface WorkspaceMembersTabProps {
  currentUserId?: string;
  onMemberChanged?: () => void;
  session?: { runServerTransition: (op: () => Promise<unknown>) => Promise<unknown> };
  workspaceId: string;
}

export function WorkspaceMembersTab({
  currentUserId,
  onMemberChanged,
  session,
  workspaceId,
}: WorkspaceMembersTabProps) {
  const [members, setMembers] = useState<DatabaseWorkspaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingMemberId, setPendingMemberId] = useState<string | null>(null);

  const isOwner = currentUserId
    ? members.some((m) => m.id === currentUserId && m.role === "owner")
    : false;
  const isLastOwner = isOwner && members.filter((m) => m.role === "owner").length <= 1;

  const refreshMembers = async () => {
    try {
      const nextMembers = await loadWorkspaceMembers(workspaceId);
      setMembers(nextMembers);
    } catch {
      // keep stale data on refresh failure
    }
  };

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");
    loadWorkspaceMembers(workspaceId)
      .then((nextMembers) => {
        if (!cancelled) setMembers(nextMembers);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "成员列表加载失败");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const handleRoleChange = async (memberId: string, role: WorkspaceRole) => {
    setPendingMemberId(memberId);
    try {
      await updateWorkspaceMemberRole(workspaceId, memberId, role);
      await refreshMembers();
      if (memberId === currentUserId) {
        onMemberChanged?.();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "角色变更失败");
    } finally {
      setPendingMemberId(null);
    }
  };

  const handleRemove = async (memberId: string) => {
    setPendingMemberId(memberId);
    try {
      await removeWorkspaceMember(workspaceId, memberId);
      await refreshMembers();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移除成员失败");
    } finally {
      setPendingMemberId(null);
    }
  };

  const handleLeave = async () => {
    if (!session) return;
    setPendingMemberId(currentUserId ?? "");
    try {
      await session.runServerTransition(async () => {
        await leaveWorkspace(workspaceId);
      });
      onMemberChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "退出工作区失败");
    } finally {
      setPendingMemberId(null);
    }
  };

  if (isLoading) return <p className="py-6 text-center text-sm text-muted-foreground">正在加载成员...</p>;
  if (error) return <p className="py-4 text-sm text-destructive" role="alert">{error}</p>;
  if (members.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">暂无成员</p>;

  return (
    <>
      <div className="divide-y border-y">
        {members.map((member) => {
          const isSelf = member.id === currentUserId;
          return (
            <div className="flex items-center gap-3 py-3" key={member.id}>
              <Avatar className="size-9">
                <AvatarFallback>{member.displayName.trim().charAt(0) || "N"}</AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1">
                <strong className="truncate text-sm font-medium">
                  {member.displayName}
                  {isSelf ? <span className="ml-1 font-normal text-muted-foreground">(你)</span> : null}
                </strong>
                <small className="truncate text-xs text-muted-foreground">{member.email}</small>
              </span>
              {isOwner && member.role !== "owner" ? (
                <Select
                  disabled={pendingMemberId === member.id}
                  onValueChange={(value) => void handleRoleChange(member.id, value as WorkspaceRole)}
                  value={member.role}
                >
                  <SelectTrigger className="w-24" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EDITABLE_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant={member.role === "owner" ? "default" : "outline"}>{ROLE_LABELS[member.role]}</Badge>
              )}
              {isOwner && !isSelf ? (
                <MemberActionsMenu
                  disabled={pendingMemberId === member.id}
                  isLastOwner={isLastOwner}
                  member={member}
                  onRemove={() => void handleRemove(member.id)}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {isOwner && !isLastOwner ? (
        <div className="pt-3">
          <TransferOwnershipDialog
            currentUserId={currentUserId ?? ""}
            members={members.filter((m) => m.id !== currentUserId)}
            onTransfer={async (targetUserId, retainOwnerRole) => {
              setPendingMemberId(currentUserId ?? "");
              try {
                const response = await fetch(
                  `/api/workspaces/${encodeURIComponent(workspaceId)}/ownership-transfer`,
                  {
                    body: JSON.stringify({ retainOwnerRole, targetUserId }),
                    headers: { "Content-Type": "application/json" },
                    method: "POST",
                  },
                );
                if (!response.ok) {
                  const payload = await response.json() as { error?: string };
                  throw new Error(payload.error || "所有权转让失败");
                }
                await refreshMembers();
                onMemberChanged?.();
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : "所有权转让失败");
              } finally {
                setPendingMemberId(null);
              }
            }}
          />
        </div>
      ) : null}
      {isOwner && isLastOwner ? (
        <p className="pt-3 text-xs text-muted-foreground">最后一名所有者必须先转让所有权</p>
      ) : null}
      {currentUserId ? (
        <div className="pt-3">
          <LeaveDialog
            disabled={pendingMemberId === currentUserId || isLastOwner}
            isOwner={isOwner}
            onLeave={() => void handleLeave()}
          />
        </div>
      ) : null}
    </>
  );
}

function MemberActionsMenu({
  disabled,
  isLastOwner,
  member,
  onRemove,
}: {
  disabled: boolean;
  isLastOwner: boolean;
  member: DatabaseWorkspaceMember;
  onRemove: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isTargetOwner = member.role === "owner";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button disabled={disabled} size="icon" type="button" variant="ghost">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={isLastOwner}
            onClick={() => setConfirmRemove(true)}
            variant="destructive"
          >
            <UserMinus className="size-4" />
            移除成员
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog onOpenChange={setConfirmRemove} open={confirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认移除成员</DialogTitle>
            <DialogDescription>
              确定要将 {member.displayName} ({member.email}) 从工作区中移除吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmRemove(false)} type="button" variant="outline">取消</Button>
            <Button onClick={() => { setConfirmRemove(false); onRemove(); }} type="button" variant="destructive">确认移除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TransferOwnershipDialog({
  currentUserId,
  members,
  onTransfer,
}: {
  currentUserId: string;
  members: DatabaseWorkspaceMember[];
  onTransfer: (targetUserId: string, retainOwnerRole: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState("");
  const [retainOwnerRole, setRetainOwnerRole] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const targetMember = members.find((m) => m.id === targetUserId);

  const submit = async () => {
    if (!targetUserId || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onTransfer(targetUserId, retainOwnerRole);
      setOpen(false);
      setTargetUserId("");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" type="button" variant="outline">
        <ArrowRightLeft className="size-4" />转让所有权
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>转让所有权</DialogTitle>
            <DialogDescription>
              将工作区所有权转让给其他成员。被转让者将自动成为所有者。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm">
              转让目标
              <Select onValueChange={setTargetUserId} value={targetUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="选择目标成员" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName} ({ROLE_LABELS[m.role]})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                checked={retainOwnerRole}
                onChange={(e) => setRetainOwnerRole(e.target.checked)}
                type="checkbox"
              />
              我仍保留所有者角色
            </label>
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)} type="button" variant="outline">取消</Button>
            <Button
              disabled={!targetUserId || isSubmitting}
              onClick={() => void submit()}
              type="button"
            >
              {isSubmitting ? "转让中..." : "确认转让"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LeaveDialog({
  disabled,
  isOwner,
  onLeave,
}: {
  disabled: boolean;
  isOwner: boolean;
  onLeave: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        disabled={disabled}
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        退出工作区
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认退出</DialogTitle>
            <DialogDescription>
              {isOwner
                ? "你是一名所有者，退出后你将失去此工作区的所有者权限。"
                : "退出后你将无法再访问此工作区。"}此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setOpen(false)} type="button" variant="outline">取消</Button>
            <Button onClick={() => { setOpen(false); onLeave(); }} type="button" variant="destructive">确认退出</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
