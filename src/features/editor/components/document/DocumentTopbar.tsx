import { History, Keyboard, LogOut, Mail, Menu, MessageSquare, PanelRight, Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CollaborationConnectionState } from "../../collaboration/collaborationTypes";
import type { WorkspaceCollaborator } from "../../model/workspaceOperations";
import type { EditorSessionUser } from "../../session/sessionTypes";
import { COLLABORATION_STATUS_LABELS } from "./documentEditorTypes";

interface DocumentTopbarProps {
  collaborators: WorkspaceCollaborator[];
  collaborationState: CollaborationConnectionState;
  isContextOpen: boolean;
  isCommentsOpen: boolean;
  isHistoryOpen: boolean;
  isMembersOpen: boolean;
  isShareOpen: boolean;
  isShortcutsOpen: boolean;
  isWorkspaceNavigationOpen: boolean;
  inviteCount: number;
  onOpenInvites?: () => void;
  onSignOut?: () => void;
  openCommentCount: number;
  memberCount: number;
  presenceCount: number;
  sessionUser: EditorSessionUser | null;
  shareEnabled: boolean;
  title: string;
  onToggleContext: () => void;
  onToggleComments: () => void;
  onToggleHistory: () => void;
  onToggleMembers: () => void;
  onToggleShare: () => void;
  onToggleShortcuts: () => void;
  onToggleWorkspaceNavigation: () => void;
}

export function DocumentTopbar({
  collaborators,
  collaborationState,
  isContextOpen,
  isCommentsOpen,
  isHistoryOpen,
  isMembersOpen,
  isShareOpen,
  isShortcutsOpen,
  isWorkspaceNavigationOpen,
  inviteCount,
  onOpenInvites,
  onSignOut,
  openCommentCount,
  memberCount,
  presenceCount,
  sessionUser,
  shareEnabled,
  title,
  onToggleContext,
  onToggleComments,
  onToggleHistory,
  onToggleMembers,
  onToggleShare,
  onToggleShortcuts,
  onToggleWorkspaceNavigation,
}: DocumentTopbarProps) {
  const collaborationVariant = collaborationState === "connected"
    ? "success"
    : collaborationState === "connecting" ? "warning" : collaborationState === "offline" ? "destructive" : "outline";

  return (
    <header className="sticky top-0 z-20 flex min-h-14 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur-md sm:px-5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-expanded={isWorkspaceNavigationOpen}
              aria-label={isWorkspaceNavigationOpen ? "关闭工作区导航" : "打开工作区导航"}
              className="size-8 lg:hidden"
              onClick={onToggleWorkspaceNavigation}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Menu aria-hidden="true" className="size-[18px]" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>工作区导航</TooltipContent>
        </Tooltip>

        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
          <span className="hidden md:inline">团队知识库</span>
          <span aria-hidden="true" className="hidden text-border md:inline">/</span>
          <strong className="truncate font-medium text-foreground">{title}</strong>
        </div>

        <div aria-label="协作操作" className="ml-auto flex shrink-0 items-center gap-1">
          <Badge aria-live="polite" className="hidden h-7 gap-1.5 lg:inline-flex" variant={collaborationVariant}>
            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
            <span>{COLLABORATION_STATUS_LABELS[collaborationState]}</span>
            {presenceCount > 0 ? <span className="text-[10px] opacity-75">{presenceCount} 在线</span> : null}
          </Badge>

          {onOpenInvites ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={`工作区邀请 ${inviteCount}`}
                  className="relative size-8"
                  onClick={onOpenInvites}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Mail aria-hidden="true" className="size-4" />
                  {inviteCount > 0 ? (
                    <Badge
                      aria-hidden="true"
                      className="pointer-events-none absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center border-background px-1 text-[10px] leading-none"
                      variant="default"
                    >
                      {inviteCount > 99 ? "99+" : inviteCount}
                    </Badge>
                  ) : null}
                </Button>
              </TooltipTrigger>
              <TooltipContent>工作区邀请</TooltipContent>
            </Tooltip>
          ) : null}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-expanded={isShortcutsOpen}
                aria-label="快捷键"
                className="hidden size-8 sm:inline-flex"
                onClick={onToggleShortcuts}
                size="icon"
                type="button"
                variant={isShortcutsOpen ? "secondary" : "ghost"}
              >
                <Keyboard aria-hidden="true" className="size-[17px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>快捷键</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button aria-expanded={isMembersOpen} aria-label={`成员 ${memberCount}`} className="h-8 gap-1.5 px-1.5 sm:px-2" onClick={onToggleMembers} type="button" variant="ghost">
                <span aria-hidden="true" className="flex items-center pl-1">
                  {collaborators.slice(0, 3).map((collaborator) => (
                    <span className={`avatar ${collaborator.color} !size-6 !border-background text-[10px]`} key={collaborator.name}>
                      {collaborator.name.slice(0, 1)}
                    </span>
                  ))}
                </span>
                <span className="hidden text-xs xl:inline">成员</span>
                <span className="text-[10px] tabular-nums text-muted-foreground">{memberCount}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>查看工作区成员</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button aria-expanded={isCommentsOpen} aria-label={`评论 ${openCommentCount}`} className="h-8 px-2" onClick={onToggleComments} type="button" variant="ghost">
                <MessageSquare aria-hidden="true" className="size-4" />
                <span className="hidden text-xs xl:inline">评论</span>
                <span className="text-[10px] tabular-nums text-muted-foreground">{openCommentCount}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>查看评论</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button aria-expanded={isHistoryOpen} aria-label="历史" className="hidden size-8 sm:inline-flex" onClick={onToggleHistory} size="icon" type="button" variant="ghost">
                <History aria-hidden="true" className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>版本历史</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-expanded={isContextOpen}
                aria-label={isContextOpen ? "关闭文档信息" : "打开文档信息"}
                className="size-8"
                onClick={onToggleContext}
                size="icon"
                type="button"
                variant={isContextOpen ? "secondary" : "ghost"}
              >
                <PanelRight aria-hidden="true" className="size-[17px]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>文档信息</TooltipContent>
          </Tooltip>

          {sessionUser && onSignOut ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={`退出 ${sessionUser.displayName}`}
                  className="hidden h-8 gap-1.5 px-1.5 md:inline-flex"
                  onClick={onSignOut}
                  type="button"
                  variant="ghost"
                >
                  <span aria-hidden="true" className="grid size-6 place-items-center rounded-md bg-primary text-[10px] font-bold text-primary-foreground">
                    {sessionUser.displayName.slice(0, 1)}
                  </span>
                  <span className="hidden max-w-20 truncate text-xs xl:inline">{sessionUser.displayName}</span>
                  <LogOut aria-hidden="true" className="size-3.5 text-muted-foreground" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>退出当前身份</TooltipContent>
            </Tooltip>
          ) : null}

          {shareEnabled ? (
            <Button aria-expanded={isShareOpen} aria-label="分享" className="h-8 px-2.5" onClick={onToggleShare} type="button">
              <Share2 aria-hidden="true" className="size-4" />
              <span className="hidden text-xs sm:inline">分享</span>
            </Button>
          ) : null}
        </div>
    </header>
  );
}
