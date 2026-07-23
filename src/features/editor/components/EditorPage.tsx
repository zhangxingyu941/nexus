import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CollaborationSessionProvider } from "../collaboration/CollaborationSessionContext";
import { useDocumentCollaboration } from "../collaboration/useDocumentCollaboration";
import { MentionSearchProvider } from "./MentionSearchContext";
import { useMentionSearchFn } from "./commands/useMentionSearch";
import type { WorkspaceSummary } from "../../../shared/workspace";
import type { Block, BlockData, BlockStatus, BlockType, EditorDocument, EditorWorkspace, HeadingLevel, MoveDirection } from "../model/block";
import { projectRichTextContent, type RichTextUpdate } from "@/shared/richText";
import {
  addBlockComment,
  changeBlockType,
  createBlockId,
  createBlock,
  deleteBlock,
  insertBlockAfter,
  indentBlock,
  moveBlock,
  outdentBlock,
  resolveBlockComment,
  restoreBlock,
  setBlockAssignee,
  setBlockDueDate,
  setBlockStatus,
  toggleTodo,
  updateBlockContent,
  updateBlockRichText,
  updateBlockData,
  updateDocumentTitle,
} from "../model/documentOperations";
import {
  createBlockClipboardPayload,
  insertClipboardBlocksAfter,
  materializeClipboardBlocks,
  type NexusBlockClipboardPayload,
} from "../model/blockClipboard";
import {
  deleteBlocks,
  changeBlockTypes,
  duplicateBlockRoots,
  indentBlockRoots,
  moveBlockRoots,
  outdentBlockRoots,
  toggleMarkForBlocks,
  type BatchBlockMutationResult,
} from "../model/batchBlockOperations";
import {
  type CreateWorkspaceDocumentInput,
  createWorkspaceDocument,
  deleteWorkspaceDocument,
  duplicateWorkspaceDocument,
  getActiveDocument,
  getWorkspaceActivities,
  getWorkspaceCollaborators,
  getWorkspaceSearchResults,
  getWorkspaceTasks,
  restoreWorkspaceDocument,
  switchActiveDocument,
  toggleDocumentPinned,
  applyRemoteDocumentStructurePatch,
  applyRemoteBlockContentPatch,
  updateDocumentBlockStatus,
  updateActiveDocument,
} from "../model/workspaceOperations";
import { loadWorkspaceMembers } from "../persistence/workspaceMemberRepository";
import { pasteBlockClipboard } from "../persistence/blockClipboardRepository";
import type {
  DatabaseWorkspaceMember,
  EditorSessionUser,
} from "../session/sessionTypes";
import type { WorkspaceSaveStatus } from "../session/useWorkspaceSession";
import type { MarkdownTransferTarget } from "../persistence/markdownTransferRepository";
import { DocumentEditor } from "./DocumentEditor";
import type { BlockSelectionToolbarAction } from "./BlockSelectionToolbar";
import { useBlockClipboard } from "./useBlockClipboard";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

type UndoDeleteNotice =
  | {
      type: "document";
      document: EditorDocument;
    }
  | {
      type: "batch";
      document: EditorDocument;
      documentId: string;
    }
  | {
      type: "block";
      block: Block;
      documentId: string;
      index: number;
    };

interface PendingBlockCut {
  copiedAt: number;
  rootBlockIds: string[];
  sourceDocumentId: string;
  sourceWorkspaceId: string;
}

function nextTimestamp(document: EditorDocument) {
  // 快速连续新增块时，用块数量错开时间戳，降低本地 ID 碰撞概率。
  return Date.now() + document.blocks.length;
}

interface EditorPageProps {
  inviteCount?: number;
  membersEnabled: boolean;
  markdownTarget?: MarkdownTransferTarget;
  onCreateDocument?: (input?: CreateWorkspaceDocumentInput) => Promise<void> | void;
  onDeleteDocument?: (documentId: string) => Promise<void> | void;
  onDuplicateDocument?: (documentId: string) => Promise<void> | void;
  onManageWorkspaces: () => void;
  onMarkdownImported?: () => Promise<void> | void;
  onOpenInvites?: () => void;
  onSignOut?: () => void;
  onWorkspaceChange: (updater: (current: EditorWorkspace) => EditorWorkspace) => void;
  documentPublicId?: string;
  documentCanWrite?: boolean;
  saveStatus: WorkspaceSaveStatus;
  sessionUser?: EditorSessionUser | null;
  workspace: EditorWorkspace;
  workspaceId: string;
  workspaceSummary: WorkspaceSummary;
}

export function EditorPage({
  inviteCount = 0,
  membersEnabled,
  markdownTarget = "local",
  onCreateDocument,
  onDeleteDocument,
  onDuplicateDocument,
  onManageWorkspaces,
  onMarkdownImported,
  onOpenInvites,
  onSignOut,
  onWorkspaceChange,
  documentPublicId,
  documentCanWrite,
  saveStatus,
  sessionUser = null,
  workspace,
  workspaceId,
  workspaceSummary,
}: EditorPageProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState<DatabaseWorkspaceMember[]>([]);
  const [titleFocusRequest, setTitleFocusRequest] = useState(0);
  const [undoDeleteNotice, setUndoDeleteNotice] = useState<UndoDeleteNotice | null>(null);
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const pendingBlockCutRef = useRef<PendingBlockCut | null>(null);
  const { copy: copyBlocks, read: readBlockClipboard } = useBlockClipboard();
  const workspaceRole = workspaceSummary.role;
  const canWriteActiveDocument = documentCanWrite ?? workspaceRole !== "viewer";

  useEffect(() => {
    if (!membersEnabled) {
      setWorkspaceMembers([]);
      return;
    }
    let cancelled = false;
    loadWorkspaceMembers(workspaceId)
      .then((members) => { if (!cancelled) setWorkspaceMembers(members); })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [membersEnabled, workspaceId]);

  useEffect(() => {
    if (!isSidebarOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsSidebarOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSidebarOpen]);

  const activeDocument = workspace ? getActiveDocument(workspace) : null;
  const workspaceActivities = workspace ? getWorkspaceActivities(workspace) : [];
  const activeDocumentActivities = activeDocument
    ? workspaceActivities.filter((activity) => activity.documentId === activeDocument.id)
    : [];
  const workspaceCollaborators = workspace ? getWorkspaceCollaborators(workspace) : [];
  const getSearchResults = useCallback(
    (query: string) => (workspace ? getWorkspaceSearchResults(workspace, query) : []),
    [workspace],
  );
  const workspaceTasks = workspace ? getWorkspaceTasks(workspace) : [];
  const mentionSearchFn = useMentionSearchFn({
    documents: workspace?.documents ?? [],
    members: workspaceMembers,
    tasks: workspaceTasks,
  });
  const handleRemotePatches = useCallback((patches: Parameters<typeof applyRemoteBlockContentPatch>[1][]) => {
    onWorkspaceChange((current) => {
      if (!current) {
        return current;
      }

      return patches.reduce((nextWorkspace, patch) => applyRemoteBlockContentPatch(nextWorkspace, patch), current);
    });
  }, []);
  const handleRemoteDocumentStructurePatch = useCallback(
    (patch: Parameters<typeof applyRemoteDocumentStructurePatch>[1]) => {
      onWorkspaceChange((current) => applyRemoteDocumentStructurePatch(current, patch));
    },
    [],
  );
  const collaboration = useDocumentCollaboration({
    document: activeDocument,
    enabled: canWriteActiveDocument,
    onRemoteDocumentStructurePatch: handleRemoteDocumentStructurePatch,
    onRemotePatches: handleRemotePatches,
    workspaceId,
  });

  const applyActiveDocumentChange = useCallback(
    (operation: (document: EditorDocument) => EditorDocument) => {
      onWorkspaceChange((current) => updateActiveDocument(current, operation, Date.now()));
    },
    [],
  );

  const handleCreateDocument = useCallback((input?: CreateWorkspaceDocumentInput) => {
    if (onCreateDocument) {
      void onCreateDocument(input);
    } else {
      onWorkspaceChange((current) => createWorkspaceDocument(current, Date.now(), input));
    }
    setIsSidebarOpen(false);
  }, [onCreateDocument, onWorkspaceChange]);

  const handleSelectDocument = useCallback((documentId: string) => {
    onWorkspaceChange((current) => switchActiveDocument(current, documentId, Date.now()));
    setIsSidebarOpen(false);
  }, []);

  const handleSelectTask = useCallback((documentId: string, blockId: string) => {
    flushSync(() => {
      setFocusBlockId(blockId);
      onWorkspaceChange((current) => switchActiveDocument(current, documentId, Date.now()));
    });

    window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-testid="block-row-${blockId}"]`)?.scrollIntoView?.({
        behavior: "smooth",
        block: "center",
      });
    }, 0);
    setIsSidebarOpen(false);
  }, []);

  const handleRenameDocument = useCallback((documentId: string) => {
    onWorkspaceChange((current) => switchActiveDocument(current, documentId, Date.now()));
    setTitleFocusRequest((current) => current + 1);
  }, []);

  const handleDuplicateDocument = useCallback((documentId: string) => {
    if (onDuplicateDocument) {
      void onDuplicateDocument(documentId);
    } else {
      onWorkspaceChange((current) =>
        current ? duplicateWorkspaceDocument(current, documentId, Date.now()) : current,
      );
    }
  }, [onDuplicateDocument, onWorkspaceChange]);

  const handleToggleDocumentPinned = useCallback((documentId: string) => {
    onWorkspaceChange((current) => toggleDocumentPinned(current, documentId, Date.now()));
  }, []);

  const handleDeleteDocument = useCallback(
    (documentId: string) => {
      if (!workspace || workspace.documents.length <= 1) {
        return;
      }

      const document = workspace.documents.find((item) => item.id === documentId);

      if (!document) {
        return;
      }

      const title = document.title.trim() || "未命名文档";

      // 删除文档是破坏性操作，先让用户明确确认。
      if (!window.confirm(`确定删除“${title}”吗？此操作无法撤销。`)) {
        return;
      }

      if (onDeleteDocument) {
        void onDeleteDocument(documentId);
        return;
      }

      setUndoDeleteNotice({ document, type: "document" });
      onWorkspaceChange((current) =>
        current ? deleteWorkspaceDocument(current, documentId, Date.now()) : current,
      );
    },
    [onDeleteDocument, onWorkspaceChange, workspace],
  );

  const handleRestoreDeletedDocument = useCallback(() => {
    onWorkspaceChange((current) => {
      if (!current || !undoDeleteNotice) {
        return current;
      }

      const now = Date.now();

      if (undoDeleteNotice.type === "document") {
        return restoreWorkspaceDocument(current, undoDeleteNotice.document, now);
      }

      if (undoDeleteNotice.type === "batch") {
        return {
          ...current,
          activeDocumentId: undoDeleteNotice.documentId,
          documents: current.documents.map((document) =>
            document.id === undoDeleteNotice.documentId ? undoDeleteNotice.document : document,
          ),
          updatedAt: now,
        };
      }

      const restoredDocuments = current.documents.map((document) =>
        document.id === undoDeleteNotice.documentId
          ? restoreBlock(document, undoDeleteNotice.block, undoDeleteNotice.index, now)
          : document,
      );

      // 块撤销后切回原文档，避免用户在其它页面点击撤销却看不到恢复结果。
      return {
        ...current,
        activeDocumentId: undoDeleteNotice.documentId,
        documents: restoredDocuments,
        updatedAt: now,
      };
    });
    setUndoDeleteNotice(null);
  }, [undoDeleteNotice]);

  const handleChangeTitle = useCallback(
    (title: string) => {
      applyActiveDocumentChange((current) => updateDocumentTitle(current, title, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  const handleAddAfter = useCallback(
    (blockId: string) => {
      if (!activeDocument) {
        return;
      }

      const now = nextTimestamp(activeDocument);
      const nextBlockId = createBlockId(now);

      flushSync(() => {
        setFocusBlockId(nextBlockId);
        onWorkspaceChange((current) =>
          current
            ? updateActiveDocument(
                current,
                (document) => insertBlockAfter(document, blockId, now, nextBlockId),
                Date.now(),
              )
            : current,
        );
      });
    },
    [activeDocument],
  );

  const handleChangeContent = useCallback(
    (blockId: string, content: string) => {
      applyActiveDocumentChange((current) => updateBlockContent(current, blockId, content, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  const handleChangeRichText = useCallback(
    (blockId: string, update: RichTextUpdate) => {
      applyActiveDocumentChange((current) => updateBlockRichText(current, blockId, update, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  const handleChangeType = useCallback(
    (blockId: string, type: BlockType, headingLevel?: HeadingLevel) => {
      applyActiveDocumentChange((current) =>
        changeBlockType(current, blockId, type, Date.now(), headingLevel),
      );
    },
    [applyActiveDocumentChange],
  );

  const handleChangeBlockData = useCallback(
    (blockId: string, data: BlockData | null) => {
      applyActiveDocumentChange((current) => updateBlockData(current, blockId, data, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  const applyBatchMutation = useCallback(
    (
      operation: (document: EditorDocument, now: number) => BatchBlockMutationResult,
      documentId = activeDocument?.id,
    ) => {
      if (!documentId) {
        return false;
      }

      const now = Date.now();
      const mutationResult: {
        value: { previousDocument: EditorDocument; result: BatchBlockMutationResult } | null;
      } = { value: null };

      flushSync(() => {
        onWorkspaceChange((current) => {
          const latestDocument = current.documents.find((document) => document.id === documentId);
          if (!latestDocument) {
            return current;
          }

          const result = operation(latestDocument, now);
          if (result.affectedBlockIds.length === 0) {
            return current;
          }

          mutationResult.value = { previousDocument: latestDocument, result };
          return {
            ...current,
            documents: current.documents.map((document) =>
              document.id === latestDocument.id ? result.document : document,
            ),
            updatedAt: now,
          };
        });
      });

      const mutation = mutationResult.value;
      if (!mutation) {
        return false;
      }

      setUndoDeleteNotice({
        document: mutation.previousDocument,
        documentId: mutation.previousDocument.id,
        type: "batch",
      });
      setFocusBlockId(mutation.result.focusBlockId);
      return true;
    },
    [activeDocument, onWorkspaceChange],
  );

  const completePendingBlockCut = useCallback(
    (payload: NexusBlockClipboardPayload) => {
      const pendingCut = pendingBlockCutRef.current;
      if (
        !pendingCut ||
        pendingCut.copiedAt !== payload.copiedAt ||
        pendingCut.sourceDocumentId !== payload.sourceDocumentId ||
        pendingCut.sourceWorkspaceId !== payload.sourceWorkspaceId
      ) {
        return;
      }

      pendingBlockCutRef.current = null;
      applyBatchMutation(
        (document, now) => deleteBlocks(document, pendingCut.rootBlockIds, now),
        pendingCut.sourceDocumentId,
      );
    },
    [applyBatchMutation],
  );

  const handleBlockSelectionAction = useCallback(
    (action: BlockSelectionToolbarAction, blockIds: string[]) => {
      if (blockIds.length === 0) {
        return false;
      }

      if (action === "cut" && !canWriteActiveDocument) {
        return false;
      }

      if (action === "copy" || action === "cut") {
        if (!activeDocument) {
          return false;
        }

        const payload = createBlockClipboardPayload(activeDocument, blockIds, workspaceId, Date.now());
        void copyBlocks(payload).then(({ ok }) => {
          if (!ok) {
            return;
          }

          pendingBlockCutRef.current = action === "cut"
            ? {
                copiedAt: payload.copiedAt,
                rootBlockIds: blockIds,
                sourceDocumentId: payload.sourceDocumentId,
                sourceWorkspaceId: payload.sourceWorkspaceId,
              }
            : null;
        });
        return false;
      }
      if (!canWriteActiveDocument) {
        return false;
      }
      if (action === "delete") {
        return applyBatchMutation((document, now) => deleteBlocks(document, blockIds, now));
      }
      if (action === "duplicate") {
        return applyBatchMutation((document, now) => {
          let nextOffset = document.blocks.length + 1;
          return duplicateBlockRoots(document, blockIds, {
            nextId: () => createBlockId(now + nextOffset++),
            now,
          });
        });
      }
      if (action === "indent") {
        return applyBatchMutation((document, now) => indentBlockRoots(document, blockIds, now));
      }
      if (action === "outdent") {
        return applyBatchMutation((document, now) => outdentBlockRoots(document, blockIds, now));
      }
      if (action === "bold" || action === "italic" || action === "strike" || action === "code") {
        return applyBatchMutation((document, now) => toggleMarkForBlocks(document, blockIds, action, now));
      }

      return false;
    },
    [activeDocument, applyBatchMutation, canWriteActiveDocument, copyBlocks, workspaceId],
  );

  const handleBlockSelectionTypeChange = useCallback(
    (type: BlockType, blockIds: string[]) => {
      if (!canWriteActiveDocument || blockIds.length === 0) {
        return false;
      }

      return applyBatchMutation((document, now) => changeBlockTypes(document, blockIds, type, now));
    },
    [applyBatchMutation, canWriteActiveDocument],
  );

  const handleBlockClipboardPaste = useCallback(
    (clipboardData: DataTransfer, targetBlockId: string) => {
      if (!canWriteActiveDocument) {
        return false;
      }

      const clipboard = readBlockClipboard(clipboardData);
      if (
        clipboard.kind === "nexus" &&
        clipboard.payload.sourceWorkspaceId === workspaceId &&
        clipboard.payload.blocks.some((block) => block.data?.kind === "image" || block.data?.kind === "file")
      ) {
        if (!activeDocument) {
          return true;
        }

        void pasteBlockClipboard(workspaceId, activeDocument.id, clipboard.payload)
          .then((blocks) => {
            const inserted = applyBatchMutation((document, now) =>
              insertClipboardBlocksAfter(document, targetBlockId, blocks, now),
            );
            if (inserted) {
              completePendingBlockCut(clipboard.payload);
            }
          })
          .catch(() => undefined);
        return true;
      }

      const inserted = applyBatchMutation((document, now) => {
        let nextOffset = document.blocks.length + 1;
        const nextId = () => createBlockId(now + nextOffset++);
        const insertedBlocks: Block[] = clipboard.kind === "nexus"
          ? materializeClipboardBlocks(clipboard.payload, { nextId, now, targetWorkspaceId: workspaceId })
          : clipboard.kind === "rich-text"
            ? [{
                ...createBlock("paragraph", now, projectRichTextContent(clipboard.richText), nextId()),
                richText: clipboard.richText,
              }]
            : [createBlock("paragraph", now, clipboard.text, nextId())];

        return insertClipboardBlocksAfter(document, targetBlockId, insertedBlocks, now);
      });
      if (inserted && clipboard.kind === "nexus") {
        completePendingBlockCut(clipboard.payload);
      }
      return inserted;
    },
    [activeDocument, applyBatchMutation, canWriteActiveDocument, completePendingBlockCut, readBlockClipboard, workspaceId],
  );

  const handleDelete = useCallback(
    (blockId: string) => {
      if (!activeDocument) {
        return;
      }

      const blockIndex = activeDocument.blocks.findIndex((block) => block.id === blockId);
      const block = activeDocument.blocks[blockIndex];

      if (!block) {
        return;
      }

      setUndoDeleteNotice({
        block,
        documentId: activeDocument.id,
        index: blockIndex,
        type: "block",
      });
      applyActiveDocumentChange((current) => deleteBlock(current, blockId, Date.now()));
    },
    [activeDocument, applyActiveDocumentChange],
  );

  const handleMove = useCallback(
    (blockId: string, direction: MoveDirection) => {
      applyActiveDocumentChange((current) => moveBlock(current, blockId, direction, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  const handleIndent = useCallback(
    (blockId: string) => {
      applyActiveDocumentChange((current) => indentBlock(current, blockId, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  const handleOutdent = useCallback(
    (blockId: string) => {
      applyActiveDocumentChange((current) => outdentBlock(current, blockId, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  const handleReorder = useCallback(
    (rootBlockIds: string[], targetBlockId: string, position: "before" | "after") => {
      return applyBatchMutation((document, now) =>
        moveBlockRoots(document, rootBlockIds, targetBlockId, position, now),
      );
    },
    [applyBatchMutation],
  );

  const handleToggleTodo = useCallback(
    (blockId: string) => {
      applyActiveDocumentChange((current) => toggleTodo(current, blockId, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  const handleChangeBlockAssignee = useCallback(
    (blockId: string, assignee: string) => {
      applyActiveDocumentChange((current) => setBlockAssignee(current, blockId, assignee, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  const handleChangeBlockDueDate = useCallback(
    (blockId: string, dueDate: string) => {
      applyActiveDocumentChange((current) => setBlockDueDate(current, blockId, dueDate, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  const handleChangeBlockStatus = useCallback(
    (blockId: string, status: BlockStatus) => {
      applyActiveDocumentChange((current) => setBlockStatus(current, blockId, status, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  const handleCompleteTask = useCallback((documentId: string, blockId: string) => {
    onWorkspaceChange((current) =>
      current ? updateDocumentBlockStatus(current, documentId, blockId, "done", Date.now()) : current,
    );
  }, []);

  const handleAddBlockComment = useCallback(
    (blockId: string, body: string) => {
      applyActiveDocumentChange((current) => addBlockComment(current, blockId, "我", body, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  const handleResolveBlockComment = useCallback(
    (blockId: string, commentId: string) => {
      applyActiveDocumentChange((current) => resolveBlockComment(current, blockId, commentId, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  const handleRestoreDocumentVersion = useCallback((document: EditorDocument) => {
    onWorkspaceChange((current) => {
      if (!current || !current.documents.some((item) => item.id === document.id)) {
        return current;
      }

      return {
        ...current,
        activeDocumentId: document.id,
        documents: current.documents.map((item) => item.id === document.id ? document : item),
        updatedAt: Math.max(current.updatedAt, document.updatedAt),
      };
    });
  }, []);

  if (!workspace || !activeDocument) {
    return (
      <main className="grid min-h-dvh place-items-center bg-background text-sm text-muted-foreground">
        <p>正在加载工作区</p>
      </main>
    );
  }

  return (
    <CollaborationSessionProvider value={{ provider: collaboration.provider ?? null }}>
      <MentionSearchProvider value={mentionSearchFn}>
      <div className={`app-shell grid h-dvh min-h-[560px] grid-cols-[270px_minmax(0,1fr)] overflow-hidden bg-background max-lg:grid-cols-1${isSidebarOpen ? " sidebar-open" : ""}`}>
      <WorkspaceSidebar
        activeDocumentId={workspace.activeDocumentId}
        documents={workspace.documents}
        isReadOnly={!canWriteActiveDocument}
        onCreateDocument={handleCreateDocument}
        onDeleteDocument={handleDeleteDocument}
        onDuplicateDocument={handleDuplicateDocument}
        onRenameDocument={handleRenameDocument}
        onCompleteTask={handleCompleteTask}
        onOpenUtilityDialog={() => setIsSidebarOpen(false)}
        onManageWorkspaces={() => {
          setIsSidebarOpen(false);
          onManageWorkspaces();
        }}
        onSelectDocument={handleSelectDocument}
        onSelectTask={handleSelectTask}
        onToggleDocumentPinned={handleToggleDocumentPinned}
        activities={workspaceActivities}
        collaborators={workspaceCollaborators}
        getSearchResults={getSearchResults}
        tasks={workspaceTasks}
        workspaceSummary={workspaceSummary}
      />
      {isSidebarOpen ? (
        <button
          aria-label="关闭工作区导航遮罩"
          className="sidebar-scrim"
          onClick={() => setIsSidebarOpen(false)}
          type="button"
        />
      ) : null}
      <DocumentEditor
        activities={activeDocumentActivities}
        collaborators={workspaceCollaborators}
        collaborationDocument={collaboration.ydoc}
        collaborationPresence={collaboration.presence}
        collaborationState={collaboration.connectionState}
        document={activeDocument}
        documentPublicId={documentPublicId}
        focusBlockId={focusBlockId}
        inviteCount={inviteCount}
        isWorkspaceNavigationOpen={isSidebarOpen}
        isReadOnly={!canWriteActiveDocument}
        markdownTarget={markdownTarget}
        onOpenInvites={onOpenInvites}
        onSignOut={onSignOut}
        onAddAfter={handleAddAfter}
        onBlockClipboardPaste={handleBlockClipboardPaste}
        onBlockSelectionAction={handleBlockSelectionAction}
        onBlockSelectionTypeChange={handleBlockSelectionTypeChange}
        onAddBlockComment={handleAddBlockComment}
        onChangeBlockAssignee={handleChangeBlockAssignee}
        onChangeBlockDueDate={handleChangeBlockDueDate}
        onChangeBlockStatus={handleChangeBlockStatus}
        onChangeBlockData={handleChangeBlockData}
        onChangeContent={handleChangeContent}
        onChangeRichText={handleChangeRichText}
        onChangeTitle={handleChangeTitle}
        onChangeType={handleChangeType}
        onFocusedBlock={() => setFocusBlockId(null)}
        onIndent={handleIndent}
        onMarkdownImported={(imported) => {
          if (markdownTarget === "remote") {
            void onMarkdownImported?.();
            return;
          }
          onWorkspaceChange((current) => ({
            ...current,
            activeDocumentId: imported.id,
            documents: [...current.documents, imported],
            updatedAt: Math.max(current.updatedAt, imported.updatedAt),
          }));
        }}
        onDelete={handleDelete}
        onMove={handleMove}
        onOutdent={handleOutdent}
        onReorder={handleReorder}
        onResolveBlockComment={handleResolveBlockComment}
        onRestoreDocumentVersion={handleRestoreDocumentVersion}
        onToggleTodo={handleToggleTodo}
        onToggleWorkspaceNavigation={() => setIsSidebarOpen((current) => !current)}
        saveStatus={saveStatus}
        sessionUser={sessionUser}
        workspaceMembers={workspaceMembers}
        workspaceId={workspaceId}
        titleFocusRequest={titleFocusRequest}
      />
      {undoDeleteNotice ? (
        <div aria-live="polite" className="undo-toast" role="status">
          <span>
            {undoDeleteNotice.type === "document"
              ? `已删除“${undoDeleteNotice.document.title.trim() || "未命名文档"}”`
              : undoDeleteNotice.type === "batch"
                ? "已应用批量块操作"
                : `已删除块“${undoDeleteNotice.block.content.trim() || "空白块"}”`}
          </span>
          <button onClick={handleRestoreDeletedDocument} type="button">
            {undoDeleteNotice.type === "batch" ? "撤销批量操作" : "撤销删除"}
          </button>
        </div>
      ) : null}
    </div>
      </MentionSearchProvider>
    </CollaborationSessionProvider>
  );
}
