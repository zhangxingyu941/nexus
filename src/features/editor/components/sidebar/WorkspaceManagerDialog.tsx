"use client";

import { ArrowLeft, Pencil, Plus, Search, Settings, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { WorkspaceCatalog, WorkspaceSummary } from "../../../../shared/workspace";
import type {
  DeletedWorkspaceSummary,
  WorkspaceDeletionSummary,
} from "../../../../shared/workspaceLifecycle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { workspaceLifecycleRepository } from "../../persistence/workspaceLifecycleRepository";
import { WorkspaceDangerZone } from "./workspace-manager/WorkspaceDangerZone";
import { WorkspaceInvitesTab } from "./workspace-manager/WorkspaceInvitesTab";
import { WorkspaceMembersTab } from "./workspace-manager/WorkspaceMembersTab";
import { WorkspaceTrashView } from "./workspace-manager/WorkspaceTrashView";

const ROLE_LABELS = { editor: "编辑者", owner: "所有者", viewer: "访客" } as const;

interface WorkspaceManagerDialogProps {
  catalog: WorkspaceCatalog;
  currentUserId?: string;
  error: string;
  isTransitioning: boolean;
  lifecycleEnabled?: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onMemberChanged?: () => void;
  onRename: (workspaceId: string, name: string) => Promise<void>;
  onSwitch: (workspaceId: string) => Promise<void>;
  open: boolean;
  session?: { runServerTransition(op: () => Promise<unknown>): Promise<unknown> };
}

type ManagementTab = "members" | "invites" | "danger";

type View =
  | { type: "list" }
  | { type: "create" }
  | { type: "rename"; workspace: WorkspaceSummary }
  | { type: "trash" }
  | { type: "manage"; workspace: WorkspaceSummary; tab: ManagementTab };

export function WorkspaceManagerDialog({
  catalog,
  currentUserId,
  error,
  isTransitioning,
  lifecycleEnabled = false,
  onClose,
  onCreate,
  onMemberChanged,
  onRename,
  onSwitch,
  open,
  session,
}: WorkspaceManagerDialogProps) {
  const [view, setView] = useState<View>({ type: "list" });
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletionSummary, setDeletionSummary] = useState<WorkspaceDeletionSummary | null>(null);
  const [trashWorkspaces, setTrashWorkspaces] = useState<DeletedWorkspaceSummary[]>([]);
  const [lifecycleError, setLifecycleError] = useState("");
  const [isLifecycleLoading, setIsLifecycleLoading] = useState(false);
  const [restoringWorkspaceId, setRestoringWorkspaceId] = useState<string | null>(null);
  const dangerWorkspaceId = view.type === "manage" && view.tab === "danger"
    ? view.workspace.id
    : "";
  const isTrashOpen = view.type === "trash";

  useEffect(() => {
    if (!open) {
      setView({ type: "list" });
      setName("");
    }
  }, [open]);

  useEffect(() => {
    if (!lifecycleEnabled || !dangerWorkspaceId) return;
    let cancelled = false;
    setDeletionSummary(null);
    setLifecycleError("");
    setIsLifecycleLoading(true);
    void workspaceLifecycleRepository.summary(dangerWorkspaceId)
      .then((summary) => {
        if (!cancelled) setDeletionSummary(summary);
      })
      .catch((caught) => {
        if (!cancelled) {
          setLifecycleError(caught instanceof Error ? caught.message : "删除摘要加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLifecycleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dangerWorkspaceId, lifecycleEnabled]);

  useEffect(() => {
    if (!lifecycleEnabled || !isTrashOpen) return;
    let cancelled = false;
    setLifecycleError("");
    setIsLifecycleLoading(true);
    void workspaceLifecycleRepository.listTrash()
      .then((workspaces) => {
        if (!cancelled) setTrashWorkspaces(workspaces);
      })
      .catch((caught) => {
        if (!cancelled) {
          setLifecycleError(caught instanceof Error ? caught.message : "回收站加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLifecycleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isTrashOpen, lifecycleEnabled]);

  const visibleWorkspaces = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? catalog.workspaces.filter((workspace) => workspace.name.toLowerCase().includes(normalized))
      : catalog.workspaces;
  }, [catalog.workspaces, query]);

  const openCreate = () => {
    setName("");
    setView({ type: "create" });
  };
  const openRename = (workspace: WorkspaceSummary) => {
    setName(workspace.name);
    setView({ type: "rename", workspace });
  };
  const openManage = (workspace: WorkspaceSummary) => {
    setView({ tab: "members", type: "manage", workspace });
  };
  const openTrash = () => {
    setView({ type: "trash" });
  };
  const returnToList = () => {
    setName("");
    setView({ type: "list" });
  };
  const submit = async () => {
    if (!name.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (view.type === "create") await onCreate(name);
      if (view.type === "rename") await onRename(view.workspace.id, name);
      returnToList();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} open={open}>
      <DialogContent className="max-h-[min(42rem,calc(100dvh-2rem))] max-w-xl overflow-hidden p-0">
        <DialogHeader className="relative border-b px-5 py-4 pr-20">
          <DialogTitle>{view.type === "manage" ? view.workspace.name : "工作区管理"}</DialogTitle>
          {lifecycleEnabled && view.type === "list" ? (
            <Button
              aria-label="打开回收站"
              className="absolute right-12 top-1/2 -translate-y-1/2"
              onClick={openTrash}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Trash2 aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
        </DialogHeader>
        {view.type === "list" ? (
          <div className="grid min-h-0 gap-4 p-5">
            <label className="relative">
              <Search aria-hidden="true" className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="搜索工作区"
                className="pl-9"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索工作区"
                role="searchbox"
                value={query}
              />
            </label>
            <div className="grid max-h-[22rem] gap-1 overflow-y-auto">
              {visibleWorkspaces.map((workspace) => {
                const current = workspace.id === catalog.currentWorkspaceId;
                return (
                  <div className="flex min-h-14 items-center gap-3 border-b px-1 py-2 last:border-b-0" data-testid={`workspace-row-${workspace.id}`} key={workspace.id}>
                    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-md border bg-muted text-sm font-semibold">
                      {workspace.name.trim().charAt(0).toUpperCase() || "N"}
                    </span>
                    <span className="grid min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <strong className="truncate text-sm">{workspace.name}</strong>
                        {current ? <Badge variant="secondary">当前</Badge> : null}
                      </span>
                      <span className="text-xs text-muted-foreground">{ROLE_LABELS[workspace.role]}</span>
                    </span>
                    {workspace.role === "owner" ? (
                      <>
                        <Button aria-label={`管理 ${workspace.name}`} onClick={() => openManage(workspace)} size="sm" type="button" variant="outline">
                          <Settings aria-hidden="true" className="size-4" />管理
                        </Button>
                        <Button aria-label={`重命名 ${workspace.name}`} onClick={() => openRename(workspace)} size="icon" type="button" variant="ghost">
                          <Pencil aria-hidden="true" className="size-4" />
                        </Button>
                      </>
                    ) : null}
                    {!current ? (
                      <Button disabled={isTransitioning} onClick={() => void onSwitch(workspace.id)} size="sm" type="button" variant="outline">
                        切换到{workspace.name}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
              {visibleWorkspaces.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的工作区</p> : null}
            </div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <Button disabled={isTransitioning} onClick={openCreate} type="button">
              <Plus aria-hidden="true" className="size-4" />新建工作区
            </Button>
          </div>
        ) : view.type === "trash" ? (
          <div className="grid min-h-0 gap-4 overflow-y-auto p-5">
            <Button aria-label="返回工作区列表" className="w-fit" onClick={returnToList} size="sm" type="button" variant="ghost">
              <ArrowLeft aria-hidden="true" className="size-4" />返回
            </Button>
            <h3 className="text-sm font-semibold">回收站</h3>
            {lifecycleError ? <p className="text-sm text-destructive" role="alert">{lifecycleError}</p> : null}
            {isLifecycleLoading ? <p className="py-6 text-center text-sm text-muted-foreground">正在加载回收站...</p> : (
              <WorkspaceTrashView
                isRestoringId={restoringWorkspaceId}
                onRestore={async (workspaceId) => {
                  if (!session) return;
                  setRestoringWorkspaceId(workspaceId);
                  try {
                    await session.runServerTransition(() => workspaceLifecycleRepository.restore(workspaceId));
                  } finally {
                    setRestoringWorkspaceId(null);
                  }
                }}
                workspaces={trashWorkspaces}
              />
            )}
          </div>
        ) : view.type === "manage" ? (
          <div className="grid min-h-0 gap-4 overflow-y-auto p-5">
            <Button aria-label="返回工作区列表" className="w-fit" onClick={returnToList} size="sm" type="button" variant="ghost">
              <ArrowLeft aria-hidden="true" className="size-4" />返回
            </Button>
            <Tabs
              onValueChange={(tab) => setView({
                tab: tab as ManagementTab,
                type: "manage",
                workspace: view.workspace,
              })}
              value={view.tab}
            >
              <TabsList className={`grid w-full ${lifecycleEnabled ? "grid-cols-3" : "grid-cols-2"}`}>
                <TabsTrigger value="members">成员</TabsTrigger>
                <TabsTrigger value="invites">邀请</TabsTrigger>
                {lifecycleEnabled ? <TabsTrigger value="danger">危险区域</TabsTrigger> : null}
              </TabsList>
              <TabsContent className="pt-2" value="members">
                <WorkspaceMembersTab
                  currentUserId={currentUserId}
                  onMemberChanged={onMemberChanged}
                  session={session}
                  workspaceId={view.workspace.id}
                />
              </TabsContent>
              <TabsContent className="pt-2" value="invites">
                <WorkspaceInvitesTab workspaceId={view.workspace.id} />
              </TabsContent>
              {lifecycleEnabled ? (
                <TabsContent className="pt-2" value="danger">
                  {lifecycleError ? <p className="py-4 text-sm text-destructive" role="alert">{lifecycleError}</p> : null}
                  {isLifecycleLoading ? <p className="py-6 text-center text-sm text-muted-foreground">正在加载删除摘要...</p> : null}
                  {deletionSummary ? (
                    <WorkspaceDangerZone
                      isDeleting={isTransitioning}
                      onDelete={async (confirmationName) => {
                        if (!session) return;
                        await session.runServerTransition(() => workspaceLifecycleRepository.delete(
                          view.workspace.id,
                          confirmationName,
                        ));
                      }}
                      summary={deletionSummary}
                    />
                  ) : null}
                </TabsContent>
              ) : null}
            </Tabs>
          </div>
        ) : (
          <form className="grid gap-5 p-5" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <Button aria-label="返回工作区列表" className="w-fit" onClick={returnToList} size="sm" type="button" variant="ghost">
              <ArrowLeft aria-hidden="true" className="size-4" />返回
            </Button>
            <label className="grid gap-2 text-sm font-medium">
              工作区名称
              <Input autoFocus maxLength={80} onChange={(event) => setName(event.target.value)} value={name} />
            </label>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <Button disabled={isSubmitting || isTransitioning || !name.trim()} type="submit">
              {view.type === "create" ? "创建并切换" : "保存名称"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
