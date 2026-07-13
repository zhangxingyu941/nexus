import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useDocumentCollaboration } from "../collaboration/useDocumentCollaboration";
import type { Block, BlockData, BlockStatus, BlockType, EditorDocument, EditorWorkspace, MoveDirection } from "../model/block";
import {
  addBlockComment,
  changeBlockType,
  createBlockId,
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
  updateBlockData,
  updateDocumentTitle,
} from "../model/documentOperations";
import {
  createDefaultWorkspace,
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
import {
  addWorkspaceMember,
  loadSyncedWorkspace,
  loadWorkspaceMembers,
  saveSyncedWorkspace,
} from "../persistence/workspaceSyncRepository";
import type {
  DatabaseWorkspaceMember,
  EditorSessionUser,
  WorkspaceAccessRole,
} from "../session/sessionTypes";
import { DocumentEditor } from "./DocumentEditor";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

type SaveStatus = "local" | "remote" | "saving" | "unsaved" | "failed" | "readonly";

type UndoDeleteNotice =
  | {
      type: "document";
      document: EditorDocument;
    }
  | {
      type: "block";
      block: Block;
      documentId: string;
      index: number;
    };

function nextTimestamp(document: EditorDocument) {
  // 快速连续新增块时，用块数量错开时间戳，降低本地 ID 碰撞概率。
  return Date.now() + document.blocks.length;
}

interface EditorPageProps {
  onSignOut?: () => void;
  sessionUser?: EditorSessionUser | null;
}

export function EditorPage({ onSignOut, sessionUser = null }: EditorPageProps = {}) {
  const [workspace, setWorkspace] = useState<EditorWorkspace | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("remote");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [workspaceMembers, setWorkspaceMembers] = useState<DatabaseWorkspaceMember[]>([]);
  const [workspaceRole, setWorkspaceRole] = useState<WorkspaceAccessRole | null>(null);
  const [titleFocusRequest, setTitleFocusRequest] = useState(0);
  const [undoDeleteNotice, setUndoDeleteNotice] = useState<UndoDeleteNotice | null>(null);
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const hasLoadedWorkspace = useRef(false);

  useEffect(() => {
    // 首次进入时恢复整个工作区；失败时回退到空工作区，避免编辑器白屏。
    let cancelled = false;

    async function loadInitialWorkspace() {
      try {
        const syncedWorkspace = await loadSyncedWorkspace();
        if (!cancelled) {
          setWorkspace(syncedWorkspace.workspace ?? createDefaultWorkspace());
          setSaveStatus(
            syncedWorkspace.role === "viewer"
              ? "readonly"
              : syncedWorkspace.source === "remote" ? "remote" : "local",
          );
          setWorkspaceRole(syncedWorkspace.role ?? null);
          if (syncedWorkspace.role) {
            loadWorkspaceMembers()
              .then((members) => {
                if (!cancelled) {
                  setWorkspaceMembers(members);
                }
              })
              .catch(() => undefined);
          }
          hasLoadedWorkspace.current = true;
        }
      } catch {
        if (!cancelled) {
          setWorkspace(createDefaultWorkspace());
          setSaveStatus("failed");
          hasLoadedWorkspace.current = true;
        }
      }
    }

    void loadInitialWorkspace();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // 工作区变更后防抖保存：优先同步后端，失败时保留本地草稿。
    if (!workspace || !hasLoadedWorkspace.current || workspaceRole === "viewer") {
      return;
    }

    setSaveStatus("unsaved");
    const timeoutId = window.setTimeout(() => {
      setSaveStatus("saving");
      saveSyncedWorkspace(workspace)
        .then((target) => setSaveStatus(target === "remote" ? "remote" : "local"))
        .catch(() => setSaveStatus("failed"));
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [workspace, workspaceRole]);

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
  const handleRemotePatches = useCallback((patches: Parameters<typeof applyRemoteBlockContentPatch>[1][]) => {
    setWorkspace((current) => {
      if (!current) {
        return current;
      }

      return patches.reduce((nextWorkspace, patch) => applyRemoteBlockContentPatch(nextWorkspace, patch), current);
    });
  }, []);
  const handleRemoteDocumentStructurePatch = useCallback(
    (patch: Parameters<typeof applyRemoteDocumentStructurePatch>[1]) => {
      setWorkspace((current) => (current ? applyRemoteDocumentStructurePatch(current, patch) : current));
    },
    [],
  );
  const collaboration = useDocumentCollaboration({
    document: activeDocument,
    enabled: workspaceRole !== "viewer",
    onRemoteDocumentStructurePatch: handleRemoteDocumentStructurePatch,
    onRemotePatches: handleRemotePatches,
  });

  const applyActiveDocumentChange = useCallback(
    (operation: (document: EditorDocument) => EditorDocument) => {
      setWorkspace((current) =>
        current ? updateActiveDocument(current, operation, Date.now()) : current,
      );
    },
    [],
  );

  const handleCreateDocument = useCallback((input?: CreateWorkspaceDocumentInput) => {
    setWorkspace((current) => (current ? createWorkspaceDocument(current, Date.now(), input) : current));
    setIsSidebarOpen(false);
  }, []);

  const handleSelectDocument = useCallback((documentId: string) => {
    setWorkspace((current) => (current ? switchActiveDocument(current, documentId, Date.now()) : current));
    setIsSidebarOpen(false);
  }, []);

  const handleSelectTask = useCallback((documentId: string, blockId: string) => {
    flushSync(() => {
      setFocusBlockId(blockId);
      setWorkspace((current) => (current ? switchActiveDocument(current, documentId, Date.now()) : current));
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
    setWorkspace((current) => (current ? switchActiveDocument(current, documentId, Date.now()) : current));
    setTitleFocusRequest((current) => current + 1);
  }, []);

  const handleDuplicateDocument = useCallback((documentId: string) => {
    setWorkspace((current) =>
      current ? duplicateWorkspaceDocument(current, documentId, Date.now()) : current,
    );
  }, []);

  const handleToggleDocumentPinned = useCallback((documentId: string) => {
    setWorkspace((current) => (current ? toggleDocumentPinned(current, documentId, Date.now()) : current));
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

      setUndoDeleteNotice({ document, type: "document" });
      setWorkspace((current) =>
        current ? deleteWorkspaceDocument(current, documentId, Date.now()) : current,
      );
    },
    [workspace],
  );

  const handleRestoreDeletedDocument = useCallback(() => {
    setWorkspace((current) => {
      if (!current || !undoDeleteNotice) {
        return current;
      }

      const now = Date.now();

      if (undoDeleteNotice.type === "document") {
        return restoreWorkspaceDocument(current, undoDeleteNotice.document, now);
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
        setWorkspace((current) =>
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

  const handleChangeType = useCallback(
    (blockId: string, type: BlockType) => {
      applyActiveDocumentChange((current) => changeBlockType(current, blockId, type, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  const handleChangeBlockData = useCallback(
    (blockId: string, data: BlockData | null) => {
      applyActiveDocumentChange((current) => updateBlockData(current, blockId, data, Date.now()));
    },
    [applyActiveDocumentChange],
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
    setWorkspace((current) =>
      current ? updateDocumentBlockStatus(current, documentId, blockId, "done", Date.now()) : current,
    );
  }, []);

  const handleInviteMember = useCallback(async (email: string, role: "editor" | "viewer") => {
    setWorkspaceMembers(await addWorkspaceMember(email, role));
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
    setWorkspace((current) => {
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
    <div className={`app-shell grid h-dvh min-h-[560px] grid-cols-[270px_minmax(0,1fr)] overflow-hidden bg-background max-lg:grid-cols-1${isSidebarOpen ? " sidebar-open" : ""}`}>
      <WorkspaceSidebar
        activeDocumentId={workspace.activeDocumentId}
        documents={workspace.documents}
        isReadOnly={workspaceRole === "viewer"}
        onCreateDocument={handleCreateDocument}
        onDeleteDocument={handleDeleteDocument}
        onDuplicateDocument={handleDuplicateDocument}
        onRenameDocument={handleRenameDocument}
        onCompleteTask={handleCompleteTask}
        onOpenUtilityDialog={() => setIsSidebarOpen(false)}
        onSelectDocument={handleSelectDocument}
        onSelectTask={handleSelectTask}
        onToggleDocumentPinned={handleToggleDocumentPinned}
        activities={workspaceActivities}
        collaborators={workspaceCollaborators}
        getSearchResults={getSearchResults}
        tasks={workspaceTasks}
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
        focusBlockId={focusBlockId}
        isWorkspaceNavigationOpen={isSidebarOpen}
        isReadOnly={workspaceRole === "viewer"}
        onInviteMember={workspaceRole === "owner" ? handleInviteMember : undefined}
        onSignOut={onSignOut}
        onAddAfter={handleAddAfter}
        onAddBlockComment={handleAddBlockComment}
        onChangeBlockAssignee={handleChangeBlockAssignee}
        onChangeBlockDueDate={handleChangeBlockDueDate}
        onChangeBlockStatus={handleChangeBlockStatus}
        onChangeBlockData={handleChangeBlockData}
        onChangeContent={handleChangeContent}
        onChangeTitle={handleChangeTitle}
        onChangeType={handleChangeType}
        onFocusedBlock={() => setFocusBlockId(null)}
        onIndent={handleIndent}
        onDelete={handleDelete}
        onMove={handleMove}
        onOutdent={handleOutdent}
        onResolveBlockComment={handleResolveBlockComment}
        onRestoreDocumentVersion={handleRestoreDocumentVersion}
        onToggleTodo={handleToggleTodo}
        onToggleWorkspaceNavigation={() => setIsSidebarOpen((current) => !current)}
        saveStatus={saveStatus}
        sessionUser={sessionUser}
        workspaceMembers={workspaceMembers}
        workspaceRole={workspaceRole}
        titleFocusRequest={titleFocusRequest}
      />
      {undoDeleteNotice ? (
        <div aria-live="polite" className="undo-toast" role="status">
          <span>
            {undoDeleteNotice.type === "document"
              ? `已删除“${undoDeleteNotice.document.title.trim() || "未命名文档"}”`
              : `已删除块“${undoDeleteNotice.block.content.trim() || "空白块"}”`}
          </span>
          <button onClick={handleRestoreDeletedDocument} type="button">
            撤销删除
          </button>
        </div>
      ) : null}
    </div>
  );
}
