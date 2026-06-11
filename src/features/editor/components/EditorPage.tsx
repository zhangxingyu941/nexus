import { useCallback, useEffect, useRef, useState } from "react";
import type { BlockType, EditorDocument, EditorWorkspace, MoveDirection } from "../model/block";
import {
  changeBlockType,
  deleteBlock,
  insertBlockAfter,
  moveBlock,
  toggleTodo,
  updateBlockContent,
} from "../model/documentOperations";
import {
  createDefaultWorkspace,
  createWorkspaceDocument,
  deleteWorkspaceDocument,
  getActiveDocument,
  switchActiveDocument,
  updateActiveDocument,
} from "../model/workspaceOperations";
import { loadWorkspace, saveWorkspace } from "../persistence/editorRepository";
import { DocumentEditor } from "./DocumentEditor";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

type SaveStatus = "saved" | "saving" | "unsaved" | "failed";

function nextTimestamp(document: EditorDocument) {
  // 快速连续新增块时，用块数量错开时间戳，降低本地 ID 碰撞概率。
  return Date.now() + document.blocks.length;
}

export function EditorPage() {
  const [workspace, setWorkspace] = useState<EditorWorkspace | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const hasLoadedWorkspace = useRef(false);

  useEffect(() => {
    // 首次进入时恢复整个工作区；失败时回退到空工作区，避免编辑器白屏。
    let cancelled = false;

    async function loadInitialWorkspace() {
      try {
        const savedWorkspace = await loadWorkspace();
        if (!cancelled) {
          setWorkspace(savedWorkspace ?? createDefaultWorkspace());
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
    // 工作区变更后防抖保存，避免每次击键都写 IndexedDB。
    if (!workspace || !hasLoadedWorkspace.current) {
      return;
    }

    setSaveStatus("unsaved");
    const timeoutId = window.setTimeout(() => {
      setSaveStatus("saving");
      saveWorkspace(workspace)
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("failed"));
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [workspace]);

  const activeDocument = workspace ? getActiveDocument(workspace) : null;

  const applyActiveDocumentChange = useCallback(
    (operation: (document: EditorDocument) => EditorDocument) => {
      setWorkspace((current) =>
        current ? updateActiveDocument(current, operation, Date.now()) : current,
      );
    },
    [],
  );

  const handleCreateDocument = useCallback(() => {
    setWorkspace((current) => (current ? createWorkspaceDocument(current, Date.now()) : current));
  }, []);

  const handleSelectDocument = useCallback((documentId: string) => {
    setWorkspace((current) => (current ? switchActiveDocument(current, documentId, Date.now()) : current));
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

      setWorkspace((current) =>
        current ? deleteWorkspaceDocument(current, documentId, Date.now()) : current,
      );
    },
    [workspace],
  );

  const handleAddAfter = useCallback(
    (blockId: string) => {
      applyActiveDocumentChange((current) => insertBlockAfter(current, blockId, nextTimestamp(current)));
    },
    [applyActiveDocumentChange],
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

  const handleDelete = useCallback(
    (blockId: string) => {
      applyActiveDocumentChange((current) => deleteBlock(current, blockId, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  const handleMove = useCallback(
    (blockId: string, direction: MoveDirection) => {
      applyActiveDocumentChange((current) => moveBlock(current, blockId, direction, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  const handleToggleTodo = useCallback(
    (blockId: string) => {
      applyActiveDocumentChange((current) => toggleTodo(current, blockId, Date.now()));
    },
    [applyActiveDocumentChange],
  );

  if (!workspace || !activeDocument) {
    return (
      <main className="editor-page editor-loading">
        <p>加载中</p>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <WorkspaceSidebar
        activeDocumentId={workspace.activeDocumentId}
        documents={workspace.documents}
        onCreateDocument={handleCreateDocument}
        onDeleteDocument={handleDeleteDocument}
        onSelectDocument={handleSelectDocument}
      />
      <DocumentEditor
        document={activeDocument}
        onAddAfter={handleAddAfter}
        onChangeContent={handleChangeContent}
        onChangeType={handleChangeType}
        onDelete={handleDelete}
        onMove={handleMove}
        onToggleTodo={handleToggleTodo}
        saveStatus={saveStatus}
      />
    </div>
  );
}
