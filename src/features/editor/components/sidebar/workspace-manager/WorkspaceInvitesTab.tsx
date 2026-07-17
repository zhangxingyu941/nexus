"use client";

import { RotateCw, Send, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  WorkspaceInviteMutationResponse,
  WorkspaceInviteRole,
  WorkspaceInviteStatus,
  WorkspaceInviteSummary,
} from "../../../../../shared/workspaceInvites";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { workspaceInviteRepository } from "../../../persistence/workspaceInviteRepository";

const ROLE_LABELS: Record<WorkspaceInviteRole, string> = {
  editor: "编辑者",
  viewer: "访客",
};

const STATUS_LABELS: Record<WorkspaceInviteStatus, string> = {
  accepted: "已接受",
  declined: "已拒绝",
  expired: "已过期",
  pending: "待接受",
  revoked: "已撤销",
};

interface WorkspaceInvitesTabProps {
  workspaceId: string;
}

export function WorkspaceInvitesTab({ workspaceId }: WorkspaceInvitesTabProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceInviteRole | "">("");
  const [invites, setInvites] = useState<WorkspaceInviteSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [activeInviteId, setActiveInviteId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [, setClock] = useState(() => Date.now());

  const loadInvites = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      setInvites(await workspaceInviteRepository.listSent(workspaceId));
    } catch (caught) {
      setError(errorMessage(caught, "邀请记录加载失败"));
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const pendingInvites = useMemo(
    () => invites.filter((invite) => invite.status === "pending"),
    [invites],
  );
  const historyInvites = useMemo(
    () => invites.filter((invite) => invite.status !== "pending"),
    [invites],
  );

  const replaceInvite = (nextInvite: WorkspaceInviteSummary) => {
    setInvites((current) => {
      const exists = current.some((invite) => invite.id === nextInvite.id);
      return exists
        ? current.map((invite) => invite.id === nextInvite.id ? nextInvite : invite)
        : [nextInvite, ...current];
    });
  };

  const reportMutation = (response: WorkspaceInviteMutationResponse, successMessage: string) => {
    replaceInvite(response.invite);
    setMessage(response.deliveryWarning?.error ?? successMessage);
  };

  const createInvite = async (nextEmail: string, nextRole: WorkspaceInviteRole) => {
    setIsCreating(true);
    setError("");
    setMessage("");
    try {
      const response = await workspaceInviteRepository.create(
        workspaceId,
        nextEmail.trim(),
        nextRole,
      );
      reportMutation(response, "邀请已发送");
      setEmail("");
      setRole("");
    } catch (caught) {
      setError(errorMessage(caught, "邀请发送失败"));
    } finally {
      setIsCreating(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || !role || isCreating) return;
    void createInvite(email, role);
  };

  const resend = async (invite: WorkspaceInviteSummary) => {
    setActiveInviteId(invite.id);
    setError("");
    setMessage("");
    try {
      reportMutation(
        await workspaceInviteRepository.resend(workspaceId, invite.id),
        "邀请已重新发送",
      );
    } catch (caught) {
      setError(errorMessage(caught, "邀请重发失败"));
    } finally {
      setActiveInviteId(null);
    }
  };

  const revoke = async (invite: WorkspaceInviteSummary) => {
    setActiveInviteId(invite.id);
    setError("");
    setMessage("");
    try {
      await workspaceInviteRepository.revoke(workspaceId, invite.id);
      replaceInvite({ ...invite, status: "revoked", updatedAt: Date.now() });
      setMessage("邀请已撤销");
    } catch (caught) {
      setError(errorMessage(caught, "邀请撤销失败"));
    } finally {
      setActiveInviteId(null);
    }
  };

  return (
    <div className="grid gap-5">
      <form className="grid gap-3 border-b pb-5" onSubmit={submit}>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
          <label className="grid min-w-0 gap-1.5 text-sm font-medium">
            成员邮箱
            <Input
              aria-label="成员邮箱"
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="member@example.com"
              required
              type="email"
              value={email}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            邀请角色
            <Select
              onValueChange={(value) => setRole(value as WorkspaceInviteRole)}
              value={role}
            >
              <SelectTrigger aria-label="邀请角色" className="w-full">
                <SelectValue placeholder="选择角色" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="editor">编辑者</SelectItem>
                <SelectItem value="viewer">访客</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <Button disabled={isCreating || !email.trim() || !role} type="submit">
            <Send aria-hidden="true" className="size-4" />
            发送邀请
          </Button>
        </div>
        {message ? <p aria-live="polite" className="text-sm text-muted-foreground" role="status">{message}</p> : null}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
      </form>

      {isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">正在加载邀请...</p> : (
        <div className="grid gap-6">
          <InviteSection
            activeInviteId={activeInviteId}
            invites={pendingInvites}
            label="待处理邀请"
            onResend={resend}
            onRevoke={revoke}
          />
          <InviteSection
            activeInviteId={activeInviteId}
            invites={historyInvites}
            label="最近 30 天"
            onReinvite={(invite) => void createInvite(invite.email, invite.role)}
          />
        </div>
      )}
    </div>
  );
}

interface InviteSectionProps {
  activeInviteId: string | null;
  invites: WorkspaceInviteSummary[];
  label: string;
  onReinvite?: (invite: WorkspaceInviteSummary) => void;
  onResend?: (invite: WorkspaceInviteSummary) => void;
  onRevoke?: (invite: WorkspaceInviteSummary) => void;
}

function InviteSection({
  activeInviteId,
  invites,
  label,
  onReinvite,
  onResend,
  onRevoke,
}: InviteSectionProps) {
  return (
    <section aria-label={label} className="grid gap-2">
      <h3 className="text-sm font-semibold">{label}</h3>
      {invites.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">暂无记录</p>
      ) : (
        <div className="divide-y border-y">
          {invites.map((invite) => {
            const cooldown = Math.max(0, Math.ceil((invite.updatedAt + 60_000 - Date.now()) / 1_000));
            const isActive = activeInviteId === invite.id;
            const canReinvite = invite.status === "declined"
              || invite.status === "expired"
              || invite.status === "revoked";
            return (
              <div
                className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center"
                data-testid={`workspace-invite-${invite.id}`}
                key={invite.id}
              >
                <div className="grid min-w-0 flex-1 gap-1">
                  <strong className="truncate text-sm font-medium">{invite.email}</strong>
                  <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{ROLE_LABELS[invite.role]}</span>
                    <Badge variant={invite.deliveryStatus === "failed" ? "destructive" : "outline"}>
                      {invite.deliveryStatus === "failed" ? "发送失败" : STATUS_LABELS[invite.status]}
                    </Badge>
                  </span>
                </div>
                {invite.status === "pending" ? (
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Button
                      aria-label={cooldown > 0 ? `${cooldown} 秒后可重发` : "重发"}
                      disabled={isActive || cooldown > 0}
                      onClick={() => onResend?.(invite)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <RotateCw aria-hidden="true" className="size-4" />
                      {cooldown > 0 ? `${cooldown} 秒后可重发` : "重发"}
                    </Button>
                    <Button
                      disabled={isActive}
                      onClick={() => onRevoke?.(invite)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      <X aria-hidden="true" className="size-4" />
                      撤销
                    </Button>
                  </div>
                ) : canReinvite ? (
                  <Button
                    disabled={isActive}
                    onClick={() => onReinvite?.(invite)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <RotateCw aria-hidden="true" className="size-4" />
                    重新邀请
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
