import { useEffect, useMemo, useRef, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  CollaborationConnectionState,
  CollaborationDocument,
  CollaborationPresence,
} from "../collaboration/collaborationTypes";
import type { BlockData, BlockStatus, BlockType, EditorDocument, MoveDirection } from "../model/block";
import type { WorkspaceActivity, WorkspaceCollaborator } from "../model/workspaceOperations";
import type {
  DatabaseWorkspaceMember,
  EditorSessionUser,
} from "../session/sessionTypes";
import { BlockList } from "./BlockList";
import { DocumentContextPanel } from "./DocumentContextPanel";
import { CommentsPanel } from "./document/CommentsPanel";
import { DocumentTitleSection } from "./document/DocumentTitleSection";
import { DocumentTopbar } from "./document/DocumentTopbar";
import { getBlockPreview, getDocumentTitle } from "./document/documentEditorTypes";
import type { WorkspaceSaveStatus } from "../session/useWorkspaceSession";
import type { CommentFilter, SharePermission } from "./document/documentEditorTypes";
import { HistoryPanel } from "./document/HistoryPanel";
import { MembersPopover } from "./document/MembersPopover";
import { SharePopover } from "./document/SharePopover";

interface DocumentEditorProps {
  activities: WorkspaceActivity[];
  collaborators: WorkspaceCollaborator[];
  collaborationDocument: CollaborationDocument | null;
  collaborationPresence: CollaborationPresence[];
  collaborationState: CollaborationConnectionState;
  document: EditorDocument;
  focusBlockId: string | null;
  inviteCount: number;
  isWorkspaceNavigationOpen: boolean;
  isReadOnly: boolean;
  onSignOut?: () => void;
  onOpenInvites?: () => void;
  saveStatus: WorkspaceSaveStatus;
  sessionUser: EditorSessionUser | null;
  workspaceMembers: DatabaseWorkspaceMember[];
  workspaceId: string;
  titleFocusRequest: number;
  onAddAfter: (blockId: string) => void;
  onAddBlockComment: (blockId: string, body: string) => void;
  onChangeBlockAssignee: (blockId: string, assignee: string) => void;
  onChangeBlockDueDate: (blockId: string, dueDate: string) => void;
  onChangeBlockStatus: (blockId: string, status: BlockStatus) => void;
  onChangeBlockData: (blockId: string, data: BlockData | null) => void;
  onChangeContent: (blockId: string, content: string) => void;
  onChangeTitle: (title: string) => void;
  onChangeType: (blockId: string, type: BlockType) => void;
  onDelete: (blockId: string) => void;
  onFocusedBlock: () => void;
  onIndent: (blockId: string) => void;
  onMove: (blockId: string, direction: MoveDirection) => void;
  onOutdent: (blockId: string) => void;
  onResolveBlockComment: (blockId: string, commentId: string) => void;
  onRestoreDocumentVersion: (document: EditorDocument) => void;
  onToggleTodo: (blockId: string) => void;
  onToggleWorkspaceNavigation: () => void;
}

export function DocumentEditor({
  activities,
  collaborators,
  collaborationDocument,
  collaborationPresence,
  collaborationState,
  document,
  focusBlockId,
  inviteCount,
  isWorkspaceNavigationOpen,
  isReadOnly,
  onSignOut,
  onOpenInvites,
  saveStatus,
  sessionUser,
  workspaceMembers,
  workspaceId,
  titleFocusRequest,
  onAddAfter,
  onAddBlockComment,
  onChangeBlockAssignee,
  onChangeBlockDueDate,
  onChangeBlockStatus,
  onChangeBlockData,
  onChangeContent,
  onChangeTitle,
  onChangeType,
  onDelete,
  onFocusedBlock,
  onIndent,
  onMove,
  onOutdent,
  onResolveBlockComment,
  onRestoreDocumentVersion,
  onToggleTodo,
  onToggleWorkspaceNavigation,
}: DocumentEditorProps) {
  const title = getDocumentTitle(document);
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isContextOpen, setIsContextOpen] = useState(false);
  const [isMembersOpen, setIsMembersOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [commentFilter, setCommentFilter] = useState<CommentFilter>("open");
  const [sharePermission, setSharePermission] = useState<SharePermission>("private");
  const [shareStatus, setShareStatus] = useState("");
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const documentScrollRef = useRef<HTMLDivElement | null>(null);
  const blockComments = useMemo(
    () =>
      document.blocks.flatMap((block) =>
        block.comments.map((comment) => ({
          ...comment,
          blockId: block.id,
          blockPreview: getBlockPreview(block.content),
        })),
      ),
    [document.blocks],
  );
  const openCommentCount = blockComments.filter((comment) => !comment.resolved).length;
  const commentCount = blockComments.length;
  const visibleBlockComments =
    commentFilter === "open" ? blockComments.filter((comment) => !comment.resolved) : blockComments;
  const onlineCollaborators = collaborators.filter((collaborator) => collaborator.status !== "away");

  useEffect(() => {
    const titleInput = titleInputRef.current;

    if (!titleInput) {
      return;
    }

    titleInput.style.height = "auto";
    titleInput.style.height = `${titleInput.scrollHeight}px`;
  }, [document.title]);

  useEffect(() => {
    if (titleFocusRequest <= 0) {
      return;
    }

    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [titleFocusRequest]);

  useEffect(() => {
    setIsContextOpen(false);
  }, [document.id]);

  const handleCopyLink = () => {
    const shareLink = `${window.location.origin}/documents/${document.id}`;

    // 浏览器支持剪贴板时写入真实链接；测试和受限环境下仍给出明确反馈。
    void navigator.clipboard?.writeText(shareLink)?.catch(() => undefined);
    setShareStatus("链接已复制");
  };

  return (
    <TooltipProvider delayDuration={350}>
      <main className={`relative grid min-h-dvh min-w-0 grid-rows-[auto_minmax(0,1fr)] bg-background${isReadOnly ? " main-pane-readonly" : ""}`}>
      <DocumentTopbar
        collaborators={collaborators}
        collaborationState={collaborationState}
        isContextOpen={isContextOpen}
        isCommentsOpen={isCommentsOpen}
        isHistoryOpen={isHistoryOpen}
        isMembersOpen={isMembersOpen}
        isShareOpen={isShareOpen}
        isWorkspaceNavigationOpen={isWorkspaceNavigationOpen}
        inviteCount={inviteCount}
        onOpenInvites={onOpenInvites}
        onSignOut={onSignOut}
        openCommentCount={openCommentCount}
        presenceCount={collaborationPresence.length}
        memberCount={workspaceMembers.length || collaborators.length}
        sessionUser={sessionUser}
        title={title}
        onToggleContext={() => setIsContextOpen((current) => !current)}
        onToggleComments={() => {
          setIsCommentsOpen((current) => !current);
          setIsHistoryOpen(false);
          setIsMembersOpen(false);
        }}
        onToggleHistory={() => {
          setIsHistoryOpen((current) => !current);
          setIsCommentsOpen(false);
          setIsMembersOpen(false);
        }}
        onToggleMembers={() => {
          setIsMembersOpen((current) => !current);
          setIsCommentsOpen(false);
          setIsHistoryOpen(false);
        }}
        onToggleShare={() => setIsShareOpen((current) => !current)}
        onToggleWorkspaceNavigation={onToggleWorkspaceNavigation}
      />

      <div className="editor-workbench min-h-0 min-w-0">
        <div className="document-scroll min-h-0 min-w-0 overflow-auto" ref={documentScrollRef}>
          <article aria-label="文档编辑区" className="document">
            <DocumentTitleSection
              document={document}
              isReadOnly={isReadOnly}
              openCommentCount={openCommentCount}
              saveStatus={saveStatus}
              titleInputRef={titleInputRef}
              onChangeTitle={onChangeTitle}
            />

            <BlockList
              blocks={document.blocks}
              collaborationDocument={collaborationDocument}
              focusBlockId={focusBlockId}
              isReadOnly={isReadOnly}
              onAddAfter={onAddAfter}
              onAddBlockComment={onAddBlockComment}
              onChangeBlockAssignee={onChangeBlockAssignee}
              onChangeBlockDueDate={onChangeBlockDueDate}
              onChangeBlockStatus={onChangeBlockStatus}
              onChangeBlockData={onChangeBlockData}
              onChangeContent={onChangeContent}
              onChangeType={onChangeType}
              onDelete={onDelete}
              onFocusedBlock={onFocusedBlock}
              onIndent={onIndent}
              onMove={onMove}
              onOutdent={onOutdent}
              onResolveBlockComment={onResolveBlockComment}
              onToggleTodo={onToggleTodo}
              scrollElementRef={documentScrollRef}
              workspaceId={workspaceId}
            />

            <div className="slash-hint">
              <span className="slash-key">/</span>
              插入标题、待办、引用或协作评论
            </div>
          </article>
        </div>

        <DocumentContextPanel
          commentCount={commentCount}
          document={document}
          isOpen={isContextOpen}
          onClose={() => setIsContextOpen(false)}
        />
      </div>

      {isContextOpen ? (
        <button
          aria-label="关闭文档信息遮罩"
          className="context-scrim"
          onClick={() => setIsContextOpen(false)}
          type="button"
        />
      ) : null}

      {isShareOpen ? (
        <SharePopover
          collaborators={collaborators}
          documentId={document.id}
          sharePermission={sharePermission}
          shareStatus={shareStatus}
          onChangePermission={(permission) => {
            setSharePermission(permission);
            setShareStatus("");
          }}
          onClose={() => setIsShareOpen(false)}
          onCopyLink={handleCopyLink}
        />
      ) : null}

      {isMembersOpen ? (
        <MembersPopover
          collaborators={collaborators}
          onlineCount={collaborationPresence.length || onlineCollaborators.length}
          openCommentCount={openCommentCount}
          presence={collaborationPresence}
          workspaceMembers={workspaceMembers}
          onClose={() => setIsMembersOpen(false)}
        />
      ) : null}

      {isCommentsOpen ? (
        <CommentsPanel
          commentCount={commentCount}
          commentFilter={commentFilter}
          isReadOnly={isReadOnly}
          openCommentCount={openCommentCount}
          visibleComments={visibleBlockComments}
          onChangeFilter={setCommentFilter}
          onClose={() => setIsCommentsOpen(false)}
          onResolveBlockComment={onResolveBlockComment}
        />
      ) : null}

        {isHistoryOpen ? (
          <HistoryPanel
            activities={activities}
            documentId={document.id}
            isReadOnly={isReadOnly}
            onClose={() => setIsHistoryOpen(false)}
            onRestoreDocument={onRestoreDocumentVersion}
            workspaceId={workspaceId}
          />
        ) : null}
      </main>
    </TooltipProvider>
  );
}
