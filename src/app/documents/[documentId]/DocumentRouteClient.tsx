"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthScreen } from "../../AuthScreen";
import { DocumentEditor } from "@/features/editor/components/DocumentEditor";
import type { BlockData, BlockStatus, BlockType, EditorDocument, HeadingLevel, MoveDirection } from "@/features/editor/model/block";
import {
  addBlockComment,
  changeBlockType,
  createBlockId,
  deleteBlock,
  indentBlock,
  insertBlockAfter,
  moveBlock,
  outdentBlock,
  reorderBlock,
  resolveBlockComment,
  setBlockAssignee,
  setBlockDueDate,
  setBlockStatus,
  toggleTodo,
  updateBlockContent,
  updateBlockData,
  updateDocumentTitle,
} from "@/features/editor/model/documentOperations";
import {
  createDocumentRepository,
  type DocumentSnapshot,
} from "@/features/editor/persistence/documentRepository";
import { ApiRequestError } from "@/features/editor/persistence/apiClient";
import { loadWorkspaceMembers } from "@/features/editor/persistence/workspaceMemberRepository";
import type { DatabaseWorkspaceMember } from "@/features/editor/session/sessionTypes";
import type { WorkspaceSaveStatus } from "@/features/editor/session/useWorkspaceSession";

interface DocumentRouteClientProps {
  publicId: string;
}

type DocumentRouteState =
  | { status: "loading" }
  | { status: "authentication-required" }
  | { status: "unavailable" }
  | { message: string; status: "failed" }
  | { snapshot: DocumentSnapshot; status: "ready" };

export function DocumentRouteClient({ publicId }: DocumentRouteClientProps) {
  const repository = useMemo(() => createDocumentRepository(), []);
  const [routeState, setRouteState] = useState<DocumentRouteState>({ status: "loading" });
  const [saveStatus, setSaveStatus] = useState<WorkspaceSaveStatus>("remote");
  const [workspaceMembers, setWorkspaceMembers] = useState<DatabaseWorkspaceMember[]>([]);
  const documentRef = useRef<EditorDocument | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const loadSequenceRef = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    documentRef.current = null;
    setWorkspaceMembers([]);
    setRouteState({ status: "loading" });

    try {
      const snapshot = await repository.load(publicId);
      documentRef.current = snapshot.document;
      setSaveStatus(snapshot.access.canWrite ? "remote" : "readonly");
      setRouteState({ snapshot, status: "ready" });
      void loadWorkspaceMembers(snapshot.access.workspaceId).then(
        (members) => {
          if (loadSequenceRef.current === sequence) setWorkspaceMembers(members);
        },
        () => undefined,
      );
    } catch (error) {
      documentRef.current = null;
      if (error instanceof ApiRequestError && error.status === 401) {
        setRouteState({ status: "authentication-required" });
      } else if (error instanceof ApiRequestError && error.status === 404) {
        setRouteState({ status: "unavailable" });
      } else {
        setRouteState({
          message: error instanceof Error ? error.message : "文档加载失败",
          status: "failed",
        });
      }
    }
  }, [publicId, repository]);

  useEffect(() => {
    void load();
    return () => {
      loadSequenceRef.current += 1;
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, [load]);

  const save = useCallback(async (document: EditorDocument) => {
    setSaveStatus("saving");
    try {
      const snapshot = await repository.save(publicId, document);
      documentRef.current = snapshot.document;
      setRouteState({ snapshot, status: "ready" });
      setSaveStatus(snapshot.access.canWrite ? "remote" : "readonly");
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) {
        setRouteState({ status: "unavailable" });
      } else {
        setSaveStatus("failed");
      }
    }
  }, [publicId, repository]);

  const updateDocument = useCallback((updater: (document: EditorDocument) => EditorDocument) => {
    if (routeState.status !== "ready" || !routeState.snapshot.access.canWrite || !documentRef.current) {
      return;
    }

    const nextDocument = updater(documentRef.current);
    documentRef.current = nextDocument;
    setRouteState((current) => current.status === "ready"
      ? { ...current, snapshot: { ...current.snapshot, document: nextDocument } }
      : current);
    setSaveStatus("unsaved");
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void save(nextDocument);
    }, 250);
  }, [routeState, save]);

  if (routeState.status === "loading") {
    return <main aria-label="正在加载文档" className="grid min-h-dvh place-items-center" role="status">正在加载文档</main>;
  }
  if (routeState.status === "authentication-required") {
    return <AuthScreen onAuthenticated={() => void load()} />;
  }
  if (routeState.status === "unavailable") {
    return <UnavailableDocument />;
  }
  if (routeState.status === "failed") {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <section className="grid gap-3 text-center">
          <p role="alert">{routeState.message}</p>
          <button onClick={() => void load()} type="button">重新加载</button>
        </section>
      </main>
    );
  }

  const { access, document } = routeState.snapshot;
  const now = () => Date.now();

  return (
    <DocumentEditor
      activities={[]}
      collaborators={[]}
      collaborationDocument={null}
      collaborationPresence={[]}
      collaborationState="disabled"
      document={document}
      documentPublicId={publicId}
      focusBlockId={null}
      inviteCount={0}
      isReadOnly={!access.canWrite}
      isWorkspaceNavigationOpen={false}
      onAddAfter={(blockId) => {
        const timestamp = now();
        updateDocument((current) => insertBlockAfter(current, blockId, timestamp, createBlockId(timestamp)));
      }}
      onAddBlockComment={(blockId, body) => updateDocument((current) =>
        addBlockComment(current, blockId, "我", body, now()),
      )}
      onChangeBlockAssignee={(blockId, assignee) => updateDocument((current) =>
        setBlockAssignee(current, blockId, assignee, now()),
      )}
      onChangeBlockData={(blockId, data: BlockData | null) => updateDocument((current) =>
        updateBlockData(current, blockId, data, now()),
      )}
      onChangeBlockDueDate={(blockId, dueDate) => updateDocument((current) =>
        setBlockDueDate(current, blockId, dueDate, now()),
      )}
      onChangeBlockStatus={(blockId, status: BlockStatus) => updateDocument((current) =>
        setBlockStatus(current, blockId, status, now()),
      )}
      onChangeContent={(blockId, content) => updateDocument((current) =>
        updateBlockContent(current, blockId, content, now()),
      )}
      onChangeTitle={(title) => updateDocument((current) => updateDocumentTitle(current, title, now()))}
      onChangeType={(blockId, type: BlockType, headingLevel?: HeadingLevel) => updateDocument((current) =>
        changeBlockType(current, blockId, type, now(), headingLevel),
      )}
      onDelete={(blockId) => updateDocument((current) => deleteBlock(current, blockId, now()))}
      onFocusedBlock={() => undefined}
      onIndent={(blockId) => updateDocument((current) => indentBlock(current, blockId, now()))}
      onMove={(blockId, direction: MoveDirection) => updateDocument((current) =>
        moveBlock(current, blockId, direction, now()),
      )}
      onOutdent={(blockId) => updateDocument((current) => outdentBlock(current, blockId, now()))}
      onReorder={(fromId, toId, position) => updateDocument((current) =>
        reorderBlock(current, fromId, toId, position, now()),
      )}
      onResolveBlockComment={(blockId, commentId) => updateDocument((current) =>
        resolveBlockComment(current, blockId, commentId, now()),
      )}
      onRestoreDocumentVersion={(restored) => updateDocument(() => restored)}
      onToggleTodo={(blockId) => updateDocument((current) => toggleTodo(current, blockId, now()))}
      onToggleWorkspaceNavigation={() => undefined}
      saveStatus={saveStatus}
      sessionUser={null}
      titleFocusRequest={0}
      workspaceId={access.workspaceId}
      workspaceMembers={workspaceMembers}
    />
  );
}

function UnavailableDocument() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <p role="alert">文档不可用</p>
    </main>
  );
}
