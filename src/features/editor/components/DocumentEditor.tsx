import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  CollaborationConnectionState,
  CollaborationDocument,
  CollaborationPresence,
} from "../collaboration/collaborationTypes";
import type { BlockData, BlockStatus, BlockType, EditorDocument, HeadingLevel, MoveDirection } from "../model/block";
import type { RichTextUpdate } from "@/shared/richText";
import type { WorkspaceActivity, WorkspaceCollaborator } from "../model/workspaceOperations";
import type {
  DatabaseWorkspaceMember,
  EditorSessionUser,
} from "../session/sessionTypes";
import { BlockList } from "./BlockList";
import { BlockSelectionToolbar, type BlockSelectionToolbarAction } from "./BlockSelectionToolbar";
import { useBlockSelection } from "./useBlockSelection";
import { getEditorShortcut, matchesEditorShortcut } from "../commands/editorShortcuts";
import { DocumentContextPanel } from "./DocumentContextPanel";
import { EditorShortcutCenter } from "./commands/EditorShortcutCenter";
import { CommentsPanel } from "./document/CommentsPanel";
import { DocumentTitleSection } from "./document/DocumentTitleSection";
import { DocumentTopbar } from "./document/DocumentTopbar";
import { getBlockPreview, getDocumentTitle } from "./document/documentEditorTypes";
import type { WorkspaceSaveStatus } from "../session/useWorkspaceSession";
import type { CommentFilter } from "./document/documentEditorTypes";
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
  documentPublicId?: string;
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
  onBlockSelectionAction?: (action: BlockSelectionToolbarAction, blockIds: string[]) => boolean;
  onBlockSelectionTypeChange?: (type: BlockType, blockIds: string[]) => boolean;
  onBlockClipboardPaste?: (clipboardData: DataTransfer, targetBlockId: string) => boolean;
  onAddBlockComment: (blockId: string, body: string) => void;
  onChangeBlockAssignee: (blockId: string, assignee: string) => void;
  onChangeBlockDueDate: (blockId: string, dueDate: string) => void;
  onChangeBlockStatus: (blockId: string, status: BlockStatus) => void;
  onChangeBlockData: (blockId: string, data: BlockData | null) => void;
  onChangeContent: (blockId: string, content: string) => void;
  onChangeRichText: (blockId: string, update: RichTextUpdate) => void;
  onChangeTitle: (title: string) => void;
  onChangeType: (blockId: string, type: BlockType, headingLevel?: HeadingLevel) => void;
  onDelete: (blockId: string) => void;
  onFocusedBlock: () => void;
  onIndent: (blockId: string) => void;
  onMove: (blockId: string, direction: MoveDirection) => void;
  onOutdent: (blockId: string) => void;
  onReorder?: (rootBlockIds: string[], targetBlockId: string, position: "before" | "after") => boolean | void;
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
  documentPublicId,
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
  onBlockSelectionAction,
  onBlockSelectionTypeChange,
  onBlockClipboardPaste,
  onAddBlockComment,
  onChangeBlockAssignee,
  onChangeBlockDueDate,
  onChangeBlockStatus,
  onChangeBlockData,
  onChangeContent,
  onChangeRichText,
  onChangeTitle,
  onChangeType,
  onDelete,
  onFocusedBlock,
  onIndent,
  onMove,
  onOutdent,
  onReorder,
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
  const [isShortcutOpen, setIsShortcutOpen] = useState(false);
  const [commentFilter, setCommentFilter] = useState<CommentFilter>("open");
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null);
  const documentScrollRef = useRef<HTMLDivElement | null>(null);
  const blockSelection = useBlockSelection(document.blocks);
  const [blockSelectionAnchor, setBlockSelectionAnchor] = useState<{ left: number; top: number } | null>(null);
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
    setIsShortcutOpen(false);
    blockSelection.clear();
  }, [document.id]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && blockSelection.state.selectedBlockIds.length > 0) {
        blockSelection.clear();
      }
    }

    globalThis.document.addEventListener("keydown", handleKeyDown);
    return () => globalThis.document.removeEventListener("keydown", handleKeyDown);
  }, [blockSelection]);

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const targetBlockId = blockSelection.resolved.rootBlockIds.at(-1);
      if (!targetBlockId || !event.clipboardData) {
        return;
      }

      if (onBlockClipboardPaste?.(event.clipboardData, targetBlockId)) {
        event.preventDefault();
      }
    }

    globalThis.document.addEventListener("paste", handlePaste);
    return () => globalThis.document.removeEventListener("paste", handlePaste);
  }, [blockSelection.resolved.rootBlockIds, onBlockClipboardPaste]);

  useLayoutEffect(() => {
    const firstRootId = blockSelection.resolved.rootBlockIds[0];
    if (!firstRootId) {
      setBlockSelectionAnchor(null);
      return;
    }

    const row = globalThis.document.querySelector<HTMLElement>(`[data-testid="block-row-${firstRootId}"]`);
    if (!row) {
      setBlockSelectionAnchor(null);
      return;
    }

    const bounds = row.getBoundingClientRect();
    setBlockSelectionAnchor({ left: bounds.left + Math.min(bounds.width / 2, 240), top: bounds.top - 8 });
  }, [blockSelection.resolved.rootBlockIds]);

  useEffect(() => {
    const shortcut = getEditorShortcut("shortcut-center");

    function handleKeyDown(event: KeyboardEvent) {
      if (!matchesEditorShortcut(event, shortcut)) {
        return;
      }

      event.preventDefault();
      setIsShortcutOpen((current) => !current);
    }

    globalThis.document.addEventListener("keydown", handleKeyDown);
    return () => globalThis.document.removeEventListener("keydown", handleKeyDown);
  }, []);

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
        isShortcutsOpen={isShortcutOpen}
        isWorkspaceNavigationOpen={isWorkspaceNavigationOpen}
        inviteCount={inviteCount}
        onOpenInvites={onOpenInvites}
        onSignOut={onSignOut}
        openCommentCount={openCommentCount}
        presenceCount={collaborationPresence.length}
        memberCount={workspaceMembers.length || collaborators.length}
        sessionUser={sessionUser}
        shareEnabled={Boolean(documentPublicId)}
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
        onToggleShare={() => documentPublicId && setIsShareOpen((current) => !current)}
        onToggleShortcuts={() => setIsShortcutOpen((current) => !current)}
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
              documentId={document.id}
              focusBlockId={focusBlockId}
              isReadOnly={isReadOnly}
              onAddAfter={onAddAfter}
              onAddBlockComment={onAddBlockComment}
              onChangeBlockAssignee={onChangeBlockAssignee}
              onChangeBlockDueDate={onChangeBlockDueDate}
              onChangeBlockStatus={onChangeBlockStatus}
              onChangeBlockData={onChangeBlockData}
              onChangeContent={onChangeContent}
              onChangeRichText={onChangeRichText}
              onChangeType={onChangeType}
              onDelete={onDelete}
              onFocusedBlock={() => {
                blockSelection.clear();
                onFocusedBlock();
              }}
              onIndent={onIndent}
              onMove={onMove}
              onOutdent={onOutdent}
              onReorder={(rootBlockIds, targetBlockId, position) => {
                const moved = onReorder?.(rootBlockIds, targetBlockId, position);
                if (moved === true) {
                  blockSelection.clear();
                }
                return moved === true;
              }}
              onResolveBlockComment={onResolveBlockComment}
              onSelectBlock={blockSelection.select}
              selectedBlockIds={blockSelection.resolved.orderedBlockIds}
              selectedRootIds={blockSelection.resolved.rootBlockIds}
              onToggleTodo={onToggleTodo}
              scrollElementRef={documentScrollRef}
              sessionUser={sessionUser}
              showBlockActions
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
        <BlockSelectionToolbar
          anchor={blockSelectionAnchor}
          isReadOnly={isReadOnly}
          onAction={(action) => {
            if (onBlockSelectionAction?.(action, blockSelection.resolved.rootBlockIds)) {
              blockSelection.clear();
            }
          }}
          onChangeType={onBlockSelectionTypeChange ? (type) => {
            if (onBlockSelectionTypeChange(type, blockSelection.resolved.rootBlockIds)) {
              blockSelection.clear();
            }
          } : undefined}
          selectedCount={blockSelection.resolved.orderedBlockIds.length}
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

      {isShareOpen && documentPublicId ? (
        <SharePopover
          onClose={() => setIsShareOpen(false)}
          documentPublicId={documentPublicId}
          workspaceMembers={workspaceMembers}
        />
      ) : null}

      <EditorShortcutCenter isOpen={isShortcutOpen} onOpenChange={setIsShortcutOpen} />

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
