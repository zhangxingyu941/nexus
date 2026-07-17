"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { loadWorkspaceMembers } from "../../../persistence/workspaceMemberRepository";
import type { DatabaseWorkspaceMember, WorkspaceAccessRole } from "../../../session/sessionTypes";

const ROLE_LABELS: Record<WorkspaceAccessRole, string> = {
  editor: "编辑者",
  owner: "所有者",
  viewer: "访客",
};

interface WorkspaceMembersTabProps {
  workspaceId: string;
}

export function WorkspaceMembersTab({ workspaceId }: WorkspaceMembersTabProps) {
  const [members, setMembers] = useState<DatabaseWorkspaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

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

  if (isLoading) return <p className="py-6 text-center text-sm text-muted-foreground">正在加载成员...</p>;
  if (error) return <p className="py-4 text-sm text-destructive" role="alert">{error}</p>;
  if (members.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">暂无成员</p>;

  return (
    <div className="divide-y border-y">
      {members.map((member) => (
        <div className="flex items-center gap-3 py-3" key={member.id}>
          <Avatar className="size-9">
            <AvatarFallback>{member.displayName.trim().charAt(0) || "N"}</AvatarFallback>
          </Avatar>
          <span className="grid min-w-0 flex-1">
            <strong className="truncate text-sm font-medium">{member.displayName}</strong>
            <small className="truncate text-xs text-muted-foreground">{member.email}</small>
          </span>
          <Badge variant={member.role === "owner" ? "default" : "outline"}>{ROLE_LABELS[member.role]}</Badge>
        </div>
      ))}
    </div>
  );
}
