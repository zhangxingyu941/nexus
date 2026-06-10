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

type SaveStatus = "Saved" | "Saving" | "Unsaved" | "Save failed";

function nextTimestamp(document: EditorDocument) {
  return Date.now() + document.blocks.length;
}

export function EditorPage() {
  const [document, setDocument] = useState<EditorDocument | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("Saved");
  const hasLoadedDocument = useRef(false);

  useEffect(() => {
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
          setSaveStatus("Save failed");
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
    if (!document || !hasLoadedDocument.current) {
      return;
    }

    setSaveStatus("Unsaved");
    const timeoutId = window.setTimeout(() => {
      setSaveStatus("Saving");
      saveDocument(document)
        .then(() => setSaveStatus("Saved"))
        .catch(() => setSaveStatus("Save failed"));
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [document]);

  const applyChange = useCallback((operation: (current: EditorDocument) => EditorDocument) => {
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
        <p>Loading</p>
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
