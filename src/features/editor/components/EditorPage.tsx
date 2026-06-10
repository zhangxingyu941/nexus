import { useCallback, useEffect, useRef, useState } from "react";
import type { BlockType, EditorDocument, MoveDirection } from "../model/block";
import {
  changeBlockType,
  createDefaultDocument,
  deleteBlock,
  insertBlockAfter,
  moveBlock,
  toggleTodo,
  updateBlockContent,
} from "../model/documentOperations";
import { loadDocument, saveDocument } from "../persistence/editorRepository";
import { BlockList } from "./BlockList";
import { EditorToolbar } from "./EditorToolbar";

type SaveStatus = "saved" | "saving" | "unsaved" | "failed";

function nextTimestamp(document: EditorDocument) {
  // 快速连续新增块时，用块数量错开时间戳，降低本地 ID 碰撞概率。
  return Date.now() + document.blocks.length;
}

export function EditorPage() {
  const [document, setDocument] = useState<EditorDocument | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const hasLoadedDocument = useRef(false);

  useEffect(() => {
    // 首次进入时优先恢复 IndexedDB；失败时退回空文档，避免编辑器白屏。
    let cancelled = false;

    async function loadInitialDocument() {
      try {
        const savedDocument = await loadDocument();
        if (!cancelled) {
          setDocument(savedDocument ?? createDefaultDocument());
          hasLoadedDocument.current = true;
        }
      } catch {
        if (!cancelled) {
          setDocument(createDefaultDocument());
          setSaveStatus("failed");
          hasLoadedDocument.current = true;
        }
      }
    }

    void loadInitialDocument();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // 文档变更后防抖保存，减少每次击键都写 IndexedDB 的压力。
    if (!document || !hasLoadedDocument.current) {
      return;
    }

    setSaveStatus("unsaved");
    const timeoutId = window.setTimeout(() => {
      setSaveStatus("saving");
      saveDocument(document)
        .then(() => setSaveStatus("saved"))
        .catch(() => setSaveStatus("failed"));
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [document]);

  const applyChange = useCallback((operation: (current: EditorDocument) => EditorDocument) => {
    // 所有编辑行为都通过纯操作函数更新，方便测试和后续接入协同层。
    setDocument((current) => (current ? operation(current) : current));
  }, []);

  const handleAddAfter = useCallback(
    (blockId: string) => {
      applyChange((current) => insertBlockAfter(current, blockId, nextTimestamp(current)));
    },
    [applyChange],
  );

  const handleChangeContent = useCallback(
    (blockId: string, content: string) => {
      applyChange((current) => updateBlockContent(current, blockId, content, Date.now()));
    },
    [applyChange],
  );

  const handleChangeType = useCallback(
    (blockId: string, type: BlockType) => {
      applyChange((current) => changeBlockType(current, blockId, type, Date.now()));
    },
    [applyChange],
  );

  const handleDelete = useCallback(
    (blockId: string) => {
      applyChange((current) => deleteBlock(current, blockId, Date.now()));
    },
    [applyChange],
  );

  const handleMove = useCallback(
    (blockId: string, direction: MoveDirection) => {
      applyChange((current) => moveBlock(current, blockId, direction, Date.now()));
    },
    [applyChange],
  );

  const handleToggleTodo = useCallback(
    (blockId: string) => {
      applyChange((current) => toggleTodo(current, blockId, Date.now()));
    },
    [applyChange],
  );

  if (!document) {
    return (
      <main className="editor-page editor-loading">
        <p>加载中</p>
      </main>
    );
  }

  return (
    <main className="editor-page">
      <EditorToolbar saveStatus={saveStatus} />
      <BlockList
        blocks={document.blocks}
        onAddAfter={handleAddAfter}
        onChangeContent={handleChangeContent}
        onChangeType={handleChangeType}
        onDelete={handleDelete}
        onMove={handleMove}
        onToggleTodo={handleToggleTodo}
      />
    </main>
  );
}
