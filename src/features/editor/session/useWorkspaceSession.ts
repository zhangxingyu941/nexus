"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  sortWorkspaceSummaries,
  type WorkspaceCatalog,
  type WorkspaceSnapshot,
  type WorkspaceSummary,
} from "../../../shared/workspace";
import type { WorkspaceTransitionResponse } from "../../../shared/workspaceApi";
import type { EditorDocument, EditorWorkspace } from "../model/block";
import {
  createWorkspaceDocument,
  deleteWorkspaceDocument,
  duplicateWorkspaceDocument,
  type CreateWorkspaceDocumentInput,
} from "../model/workspaceOperations";
import type { DocumentRepository } from "../persistence/documentRepository";
import type { WorkspaceRepository } from "../persistence/workspaceRepository";

export type WorkspaceSaveStatus =
  | "local"
  | "remote"
  | "saving"
  | "unsaved"
  | "failed"
  | "readonly";

export interface WorkspaceSessionController {
  catalog: WorkspaceCatalog | null;
  activeDocumentCanWrite: boolean;
  snapshot: WorkspaceSnapshot | null;
  saveStatus: WorkspaceSaveStatus;
  error: string;
  isLoading: boolean;
  isTransitioning: boolean;
  updateContent(updater: (current: EditorWorkspace) => EditorWorkspace): void;
  flushSave(): Promise<void>;
  runServerTransition(
    operation: () => Promise<WorkspaceTransitionResponse>,
  ): Promise<void>;
  createDocument(input?: CreateWorkspaceDocumentInput): Promise<void>;
  deleteDocument(documentId: string): Promise<void>;
  duplicateDocument(documentId: string): Promise<void>;
  switchWorkspace(workspaceId: string): Promise<void>;
  createWorkspace(name: string): Promise<void>;
  renameWorkspace(workspaceId: string, name: string): Promise<void>;
  reload(): Promise<void>;
}

interface CurrentWorkspaceState {
  canWrite: boolean;
  content: EditorWorkspace;
  documentPublicIds: Record<string, string>;
  generation: number;
  revision: number;
  role: WorkspaceSummary["role"];
  savedRevision: number;
  workspaceId: string;
}

interface SaveRequest {
  content: EditorWorkspace;
  document: EditorDocument | null;
  documentPublicId: string | null;
  generation: number;
  revision: number;
  workspaceId: string;
}

export function useWorkspaceSession(
  repository: WorkspaceRepository,
  documentRepository?: DocumentRepository,
): WorkspaceSessionController {
  const [catalog, setCatalog] = useState<WorkspaceCatalog | null>(null);
  const [activeDocumentCanWrite, setActiveDocumentCanWrite] = useState(false);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [saveStatus, setSaveStatus] = useState<WorkspaceSaveStatus>(repository.target);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const catalogRef = useRef<WorkspaceCatalog | null>(null);
  const currentRef = useRef<CurrentWorkspaceState | null>(null);
  const generationRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const inFlightSaveRef = useRef<Promise<void> | null>(null);
  const transitionRef = useRef(false);
  const loadSequenceRef = useRef(0);
  const mountedRef = useRef(false);

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const installSnapshot = useCallback((
    nextCatalog: WorkspaceCatalog,
    nextSnapshot: WorkspaceSnapshot,
  ) => {
    generationRef.current += 1;
    const canWrite = nextSnapshot.activeDocumentAccess?.canWrite
      ?? nextSnapshot.summary.role !== "viewer";
    currentRef.current = {
      canWrite,
      content: nextSnapshot.content,
      documentPublicIds: nextSnapshot.documentPublicIds ?? {},
      generation: generationRef.current,
      revision: 0,
      role: nextSnapshot.summary.role,
      savedRevision: 0,
      workspaceId: nextSnapshot.summary.id,
    };
    catalogRef.current = nextCatalog;
    setCatalog(nextCatalog);
    setSnapshot(nextSnapshot);
    setActiveDocumentCanWrite(canWrite);
    setSaveStatus(canWrite ? repository.target : "readonly");
    setError("");
  }, [repository.target]);

  const startSave = useCallback(() => {
    const current = currentRef.current;
    if (!current || !current.canWrite || current.savedRevision >= current.revision) {
      return Promise.resolve();
    }
    if (inFlightSaveRef.current) {
      return inFlightSaveRef.current;
    }

    const request: SaveRequest = {
      content: current.content,
      document: current.content.documents.find(
        (document) => document.id === current.content.activeDocumentId,
      ) ?? null,
      documentPublicId: current.documentPublicIds[current.content.activeDocumentId] ?? null,
      generation: current.generation,
      revision: current.revision,
      workspaceId: current.workspaceId,
    };
    if (mountedRef.current) {
      setSaveStatus("saving");
    }

    const saving = (async () => {
      try {
        const savedDocument = repository.target === "remote" && documentRepository
          ? await saveRemoteDocument(documentRepository, request)
          : (await repository.save(request.workspaceId, request.content), null);
        const latest = currentRef.current;
        if (latest?.workspaceId !== request.workspaceId
          || latest.generation !== request.generation) {
          return;
        }

        const content = savedDocument && latest.content.activeDocumentId === savedDocument.id
          ? replaceWorkspaceDocument(latest.content, savedDocument)
          : latest.content;
        currentRef.current = {
          ...latest,
          content,
          savedRevision: Math.max(latest.savedRevision, request.revision),
        };
        if (content !== latest.content && mountedRef.current) {
          setSnapshot((currentSnapshot) => currentSnapshot?.summary.id === request.workspaceId
            ? { ...currentSnapshot, content }
            : currentSnapshot);
        }
        if (latest.revision === request.revision && mountedRef.current) {
          setSaveStatus(repository.target);
          setError("");
        }
      } catch (saveError) {
        if (currentRef.current?.workspaceId === request.workspaceId
          && currentRef.current.generation === request.generation
          && mountedRef.current) {
          setSaveStatus("failed");
          setError(errorMessage(saveError));
        }
        throw saveError;
      }
    })();

    inFlightSaveRef.current = saving;
    saving.then(
      () => {
        if (inFlightSaveRef.current === saving) inFlightSaveRef.current = null;
      },
      () => {
        if (inFlightSaveRef.current === saving) inFlightSaveRef.current = null;
      },
    );
    return saving;
  }, [documentRepository, repository]);

  const flushSave = useCallback(async () => {
    clearSaveTimer();

    while (true) {
      const inFlight = inFlightSaveRef.current;
      if (inFlight) {
        await inFlight;
      }

      const current = currentRef.current;
      if (!current || !current.canWrite || current.savedRevision >= current.revision) {
        return;
      }

      await startSave();
    }
  }, [clearSaveTimer, startSave]);

  const scheduleSave = useCallback(() => {
    clearSaveTimer();
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushSave().catch(() => undefined);
    }, 250);
  }, [clearSaveTimer, flushSave]);

  const updateContent = useCallback((
    updater: (current: EditorWorkspace) => EditorWorkspace,
  ) => {
    const current = currentRef.current;
    if (!current || !current.canWrite) {
      return;
    }

    const content = updater(current.content);
    const activeDocumentChanged = content.activeDocumentId !== current.content.activeDocumentId;
    const selectedDocumentPublicId = current.documentPublicIds[content.activeDocumentId];
    const shouldLoadSelectedDocument = activeDocumentChanged
      && repository.target === "remote"
      && Boolean(documentRepository)
      && Boolean(selectedDocumentPublicId);
    currentRef.current = {
      ...current,
      canWrite: shouldLoadSelectedDocument ? false : current.canWrite,
      content,
      revision: current.revision + 1,
    };
    setSnapshot((currentSnapshot) => currentSnapshot?.summary.id === current.workspaceId
      ? { ...currentSnapshot, content }
      : currentSnapshot);
    setSaveStatus("unsaved");
    setError("");
    if (shouldLoadSelectedDocument && documentRepository && selectedDocumentPublicId) {
      setActiveDocumentCanWrite(false);
      setSaveStatus("readonly");
      void documentRepository.load(selectedDocumentPublicId).then(
        (selected) => {
          const latest = currentRef.current;
          if (!latest
            || latest.generation !== current.generation
            || latest.workspaceId !== current.workspaceId
            || latest.content.activeDocumentId !== selected.document.id) {
            return;
          }
          const selectedContent = replaceWorkspaceDocument(latest.content, selected.document);
          currentRef.current = {
            ...latest,
            canWrite: selected.access.canWrite,
            content: selectedContent,
          };
          if (mountedRef.current) {
            setActiveDocumentCanWrite(selected.access.canWrite);
            setSnapshot((currentSnapshot) => currentSnapshot?.summary.id === latest.workspaceId
              ? { ...currentSnapshot, activeDocumentAccess: selected.access, content: selectedContent }
              : currentSnapshot);
            setSaveStatus(selected.access.canWrite ? repository.target : "readonly");
          }
        },
        (loadError) => {
          if (currentRef.current?.generation === current.generation && mountedRef.current) {
            setSaveStatus("failed");
            setError(errorMessage(loadError));
          }
        },
      );
      return;
    }
    scheduleSave();
  }, [documentRepository, repository.target, scheduleSave]);

  const reload = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;
    if (mountedRef.current) {
      setIsLoading(true);
      setError("");
    }

    try {
      const nextCatalog = await repository.list();
      const nextSnapshot = await loadWorkspaceSnapshot(
        repository,
        documentRepository,
        nextCatalog.currentWorkspaceId,
      );
      if (mountedRef.current && loadSequenceRef.current === sequence) {
        installSnapshot(nextCatalog, nextSnapshot);
      }
    } catch (loadError) {
      if (mountedRef.current && loadSequenceRef.current === sequence) {
        setError(errorMessage(loadError));
      }
    } finally {
      if (mountedRef.current && loadSequenceRef.current === sequence) {
        setIsLoading(false);
      }
    }
  }, [documentRepository, installSnapshot, repository]);

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    if (transitionRef.current || currentRef.current?.workspaceId === workspaceId) {
      return;
    }

    transitionRef.current = true;
    setIsTransitioning(true);
    setError("");
    try {
      await flushSave();
      const nextSnapshot = await selectWorkspaceSnapshot(repository, documentRepository, workspaceId);
      const nextCatalog = catalogForSnapshot(catalogRef.current, nextSnapshot);
      installSnapshot(nextCatalog, nextSnapshot);
    } catch (transitionError) {
      if (mountedRef.current) {
        setError(errorMessage(transitionError));
      }
    } finally {
      transitionRef.current = false;
      if (mountedRef.current) {
        setIsTransitioning(false);
      }
    }
  }, [documentRepository, flushSave, installSnapshot, repository]);

  const runServerTransition = useCallback(async (
    operation: () => Promise<WorkspaceTransitionResponse>,
  ) => {
    if (transitionRef.current) {
      return;
    }

    transitionRef.current = true;
    setIsTransitioning(true);
    setError("");
    try {
      await flushSave();
      const transition = await operation();
      installSnapshot(
        transition.catalog,
        await hydrateRemoteDocument(repository, documentRepository, transition.workspace),
      );
    } catch (transitionError) {
      if (mountedRef.current) {
        setError(errorMessage(transitionError));
      }
    } finally {
      transitionRef.current = false;
      if (mountedRef.current) {
        setIsTransitioning(false);
      }
    }
  }, [documentRepository, flushSave, installSnapshot, repository]);

  const createWorkspace = useCallback(async (name: string) => {
    if (transitionRef.current) {
      return;
    }

    transitionRef.current = true;
    setIsTransitioning(true);
    setError("");
    try {
      await flushSave();
      const nextSnapshot = await hydrateRemoteDocument(
        repository,
        documentRepository,
        await repository.create(name),
      );
      const nextCatalog = catalogForSnapshot(catalogRef.current, nextSnapshot);
      installSnapshot(nextCatalog, nextSnapshot);
    } catch (transitionError) {
      if (mountedRef.current) {
        setError(errorMessage(transitionError));
      }
    } finally {
      transitionRef.current = false;
      if (mountedRef.current) {
        setIsTransitioning(false);
      }
    }
  }, [documentRepository, flushSave, installSnapshot, repository]);

  const createRemoteDocument = useCallback(async (
    remoteDocumentRepository: DocumentRepository,
    createContent: (current: EditorWorkspace) => EditorWorkspace,
  ) => {
    if (transitionRef.current) {
      return;
    }

    transitionRef.current = true;
    setIsTransitioning(true);
    setError("");
    try {
      await flushSave();
      const current = currentRef.current;
      if (!current || !current.canWrite) {
        return;
      }

      const nextContent = createContent(current.content);
      const document = nextContent.documents.find(
        (item) => item.id === nextContent.activeDocumentId,
      );
      if (!document) {
        return;
      }

      const created = await remoteDocumentRepository.create(
        current.workspaceId,
        document,
        nextContent.documents.findIndex((item) => item.id === document.id),
      );
      const content = replaceWorkspaceDocument(nextContent, created.document);
      const documentPublicIds = {
        ...current.documentPublicIds,
        [created.document.id]: created.access.publicId,
      };
      currentRef.current = {
        ...current,
        canWrite: created.access.canWrite,
        content,
        documentPublicIds,
        savedRevision: current.revision,
      };
      if (mountedRef.current) {
        setActiveDocumentCanWrite(created.access.canWrite);
        setSnapshot((currentSnapshot) => currentSnapshot?.summary.id === current.workspaceId
          ? {
              ...currentSnapshot,
              activeDocumentAccess: created.access,
              content,
              documentPublicIds,
            }
          : currentSnapshot);
        setSaveStatus(created.access.canWrite ? repository.target : "readonly");
      }
    } catch (createError) {
      if (mountedRef.current) {
        setError(errorMessage(createError));
      }
    } finally {
      transitionRef.current = false;
      if (mountedRef.current) {
        setIsTransitioning(false);
      }
    }
  }, [flushSave, repository.target]);

  const createDocument = useCallback(async (input?: CreateWorkspaceDocumentInput) => {
    if (repository.target !== "remote" || !documentRepository) {
      updateContent((current) => createWorkspaceDocument(current, Date.now(), input));
      return;
    }

    await createRemoteDocument(
      documentRepository,
      (current) => createWorkspaceDocument(current, Date.now(), input),
    );
  }, [createRemoteDocument, documentRepository, repository.target, updateContent]);

  const duplicateDocument = useCallback(async (documentId: string) => {
    if (repository.target !== "remote" || !documentRepository) {
      updateContent((current) => duplicateWorkspaceDocument(current, documentId, Date.now()));
      return;
    }

    await createRemoteDocument(
      documentRepository,
      (current) => duplicateWorkspaceDocument(current, documentId, Date.now()),
    );
  }, [createRemoteDocument, documentRepository, repository.target, updateContent]);

  const deleteDocument = useCallback(async (documentId: string) => {
    if (repository.target !== "remote" || !documentRepository) {
      updateContent((current) => deleteWorkspaceDocument(current, documentId, Date.now()));
      return;
    }
    if (transitionRef.current) {
      return;
    }

    transitionRef.current = true;
    setIsTransitioning(true);
    setError("");
    try {
      await flushSave();
      const current = currentRef.current;
      const publicId = current?.documentPublicIds[documentId];
      if (!current || !current.canWrite || !publicId || current.content.documents.length <= 1) {
        return;
      }

      const deleted = await documentRepository.delete(current.workspaceId, publicId);
      const documentPublicIds = { ...current.documentPublicIds };
      delete documentPublicIds[documentId];
      const activeDocumentId = Object.entries(documentPublicIds).find(
        ([, candidatePublicId]) => candidatePublicId === deleted.activeDocumentPublicId,
      )?.[0];
      if (!activeDocumentId) {
        throw new Error("删除后的活动文档公开标识缺失");
      }

      const selected = await documentRepository.load(deleted.activeDocumentPublicId);
      const content = replaceWorkspaceDocument({
        ...deleteWorkspaceDocument(current.content, documentId, Date.now()),
        activeDocumentId,
      }, selected.document);
      currentRef.current = {
        ...current,
        canWrite: selected.access.canWrite,
        content,
        documentPublicIds,
        savedRevision: current.revision,
      };
      if (mountedRef.current) {
        setActiveDocumentCanWrite(selected.access.canWrite);
        setSnapshot((currentSnapshot) => currentSnapshot?.summary.id === current.workspaceId
          ? {
              ...currentSnapshot,
              activeDocumentAccess: selected.access,
              content,
              documentPublicIds,
            }
          : currentSnapshot);
        setSaveStatus(selected.access.canWrite ? repository.target : "readonly");
      }
    } catch (deleteError) {
      if (mountedRef.current) {
        setError(errorMessage(deleteError));
      }
    } finally {
      transitionRef.current = false;
      if (mountedRef.current) {
        setIsTransitioning(false);
      }
    }
  }, [documentRepository, flushSave, repository.target, updateContent]);

  const renameWorkspace = useCallback(async (workspaceId: string, name: string) => {
    setError("");
    try {
      const renamed = await repository.rename(workspaceId, name);
      if (catalogRef.current) {
        const nextCatalog = {
          ...catalogRef.current,
          workspaces: catalogRef.current.workspaces.map((workspace) =>
            workspace.id === workspaceId ? renamed : workspace),
        };
        catalogRef.current = nextCatalog;
        setCatalog(nextCatalog);
      }
      setSnapshot((currentSnapshot) => currentSnapshot?.summary.id === workspaceId
        ? { ...currentSnapshot, summary: renamed }
        : currentSnapshot);
    } catch (renameError) {
      if (mountedRef.current) {
        setError(errorMessage(renameError));
      }
    }
  }, [repository]);

  useEffect(() => {
    mountedRef.current = true;
    void reload();

    return () => {
      mountedRef.current = false;
      loadSequenceRef.current += 1;
      clearSaveTimer();
    };
  }, [clearSaveTimer, reload]);

  return {
    activeDocumentCanWrite,
    catalog,
    snapshot,
    saveStatus,
    error,
    isLoading,
    isTransitioning,
    updateContent,
    flushSave,
    runServerTransition,
    createDocument,
    deleteDocument,
    duplicateDocument,
    switchWorkspace,
    createWorkspace,
    renameWorkspace,
    reload,
  };
}

function catalogForSnapshot(
  catalog: WorkspaceCatalog | null,
  snapshot: WorkspaceSnapshot,
): WorkspaceCatalog {
  const workspaces = catalog?.workspaces.some((workspace) => workspace.id === snapshot.summary.id)
    ? catalog.workspaces.map((workspace) =>
        workspace.id === snapshot.summary.id ? snapshot.summary : workspace)
    : [...(catalog?.workspaces ?? []), snapshot.summary];

  return {
    currentWorkspaceId: snapshot.summary.id,
    workspaces: sortWorkspaceSummaries(workspaces, snapshot.summary.id),
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "工作区操作失败";
}

async function loadWorkspaceSnapshot(
  repository: WorkspaceRepository,
  documentRepository: DocumentRepository | undefined,
  workspaceId: string,
) {
  return hydrateRemoteDocument(repository, documentRepository, await repository.load(workspaceId));
}

async function selectWorkspaceSnapshot(
  repository: WorkspaceRepository,
  documentRepository: DocumentRepository | undefined,
  workspaceId: string,
) {
  return hydrateRemoteDocument(repository, documentRepository, await repository.select(workspaceId));
}

async function hydrateRemoteDocument(
  repository: WorkspaceRepository,
  documentRepository: DocumentRepository | undefined,
  snapshot: WorkspaceSnapshot,
): Promise<WorkspaceSnapshot> {
  if (repository.target !== "remote" || !documentRepository) {
    return snapshot;
  }

  const publicId = snapshot.documentPublicIds?.[snapshot.content.activeDocumentId];
  if (!publicId) {
    throw new Error("文档公开标识缺失");
  }

  const { access, document } = await documentRepository.load(publicId);
  return {
    ...snapshot,
    activeDocumentAccess: access,
    content: replaceWorkspaceDocument(snapshot.content, document),
  };
}

async function saveRemoteDocument(
  documentRepository: DocumentRepository,
  request: SaveRequest,
) {
  if (!request.document || !request.documentPublicId) {
    throw new Error("文档公开标识缺失");
  }
  const saved = await documentRepository.save(request.documentPublicId, request.document);
  return saved.document;
}

function replaceWorkspaceDocument(
  workspace: EditorWorkspace,
  document: EditorDocument,
): EditorWorkspace {
  if (!workspace.documents.some((item) => item.id === document.id)) {
    return workspace;
  }

  return {
    ...workspace,
    documents: workspace.documents.map((item) => item.id === document.id ? document : item),
    updatedAt: Math.max(workspace.updatedAt, document.updatedAt),
  };
}
