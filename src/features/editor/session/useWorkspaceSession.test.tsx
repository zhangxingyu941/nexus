import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceCatalog, WorkspaceSnapshot, WorkspaceSummary } from "../../../shared/workspace";
import { createDefaultWorkspace } from "../model/workspaceOperations";
import type { WorkspaceRepository } from "../persistence/workspaceRepository";
import type { DocumentRepository } from "../persistence/documentRepository";
import { useWorkspaceSession } from "./useWorkspaceSession";

describe("useWorkspaceSession", () => {
  it("loads the selected workspace without creating fallback content", async () => {
    const workspaceA = createSnapshot("workspace-a", "Alpha", "owner", 1000);
    const repository = createRepository({
      catalog: createCatalog(workspaceA.summary),
      snapshots: { "workspace-a": workspaceA },
      target: "remote",
    });
    const { result } = renderHook(() => useWorkspaceSession(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(repository.list).toHaveBeenCalledTimes(1);
    expect(repository.load).toHaveBeenCalledWith("workspace-a");
    expect(result.current.snapshot).toEqual(workspaceA);
    expect(result.current.saveStatus).toBe("remote");
    expect(result.current.error).toBe("");
  });

  it("saves a remote active document through the document endpoint", async () => {
    const workspace = createSnapshot("workspace-a", "Alpha", "owner", 1000);
    const document = workspace.content.documents[0];
    workspace.documentPublicIds = { [document.id]: "public-document-a" };
    const repository = createRepository({
      catalog: createCatalog(workspace.summary),
      snapshots: { "workspace-a": workspace },
      target: "remote",
    });
    const documentRepository = createDocumentRepository({
      access: {
        accessMode: "workspace",
        canManage: true,
        canRead: true,
        canWrite: true,
        documentId: document.id,
        publicId: "public-document-a",
        role: "owner",
        source: "workspace-owner",
        workspaceId: "workspace-a",
      },
      document,
    });
    const { result } = renderHook(() => useWorkspaceSession(repository, documentRepository));
    await waitFor(() => expect(result.current.snapshot?.summary.id).toBe("workspace-a"));

    act(() => {
      result.current.updateContent((current) => ({
        ...current,
        documents: current.documents.map((item) => item.id === document.id
          ? { ...item, title: "Updated", updatedAt: 2000 }
          : item),
        updatedAt: 2000,
      }));
    });
    await act(async () => {
      await result.current.flushSave();
    });

    expect(documentRepository.load).toHaveBeenCalledWith("public-document-a");
    expect(documentRepository.save).toHaveBeenCalledWith(
      "public-document-a",
      expect.objectContaining({ id: document.id, updatedAt: 2000 }),
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("uses the selected document public id when saving a remote workspace", async () => {
    const workspace = createSnapshot("workspace-a", "Alpha", "owner", 1000);
    const firstDocument = workspace.content.documents[0];
    const secondDocument = { ...firstDocument, id: "document-b", title: "Second document" };
    workspace.content = {
      ...workspace.content,
      documents: [firstDocument, secondDocument],
    };
    workspace.documentPublicIds = {
      [firstDocument.id]: "public-document-a",
      [secondDocument.id]: "public-document-b",
    };
    const repository = createRepository({
      catalog: createCatalog(workspace.summary),
      snapshots: { "workspace-a": workspace },
      target: "remote",
    });
    const documentRepository = createDocumentRepository({
      access: {
        accessMode: "workspace",
        canManage: true,
        canRead: true,
        canWrite: true,
        documentId: firstDocument.id,
        publicId: "public-document-a",
        role: "owner",
        source: "workspace-owner",
        workspaceId: "workspace-a",
      },
      document: firstDocument,
    });
    vi.mocked(documentRepository.load).mockImplementation((publicId) => Promise.resolve(
      publicId === "public-document-b"
        ? {
            access: {
              accessMode: "workspace" as const,
              canManage: true,
              canRead: true,
              canWrite: true,
              documentId: secondDocument.id,
              publicId,
              role: "owner" as const,
              source: "workspace-owner" as const,
              workspaceId: "workspace-a",
            },
            document: secondDocument,
          }
        : {
            access: {
              accessMode: "workspace" as const,
              canManage: true,
              canRead: true,
              canWrite: true,
              documentId: firstDocument.id,
              publicId,
              role: "owner" as const,
              source: "workspace-owner" as const,
              workspaceId: "workspace-a",
            },
            document: firstDocument,
          },
    ));
    const { result } = renderHook(() => useWorkspaceSession(repository, documentRepository));
    await waitFor(() => expect(result.current.snapshot?.summary.id).toBe("workspace-a"));

    act(() => {
      result.current.updateContent((current) => ({
        ...current,
        activeDocumentId: secondDocument.id,
      }));
    });
    await waitFor(() => expect(documentRepository.load).toHaveBeenCalledWith("public-document-b"));
    await waitFor(() => expect(result.current.saveStatus).toBe("remote"));
    act(() => {
      result.current.updateContent((current) => ({
        ...current,
        documents: current.documents.map((item) => item.id === secondDocument.id
          ? { ...item, title: "Updated second document", updatedAt: 2000 }
          : item),
        updatedAt: 2000,
      }));
    });
    await act(async () => {
      await result.current.flushSave();
    });

    expect(documentRepository.save).toHaveBeenCalledWith(
      "public-document-b",
      expect.objectContaining({ id: secondDocument.id, updatedAt: 2000 }),
    );
  });

  it("allows an explicit document editor to save from a viewer workspace role", async () => {
    const workspace = createSnapshot("workspace-a", "Alpha", "viewer", 1000);
    const document = workspace.content.documents[0];
    workspace.documentPublicIds = { [document.id]: "public-document-a" };
    const repository = createRepository({
      catalog: createCatalog(workspace.summary),
      snapshots: { "workspace-a": workspace },
      target: "remote",
    });
    const documentRepository = createDocumentRepository({
      access: {
        accessMode: "private",
        canManage: false,
        canRead: true,
        canWrite: true,
        documentId: document.id,
        publicId: "public-document-a",
        role: "editor",
        source: "explicit",
        workspaceId: "workspace-a",
      },
      document,
    });
    const { result } = renderHook(() => useWorkspaceSession(repository, documentRepository));
    await waitFor(() => expect(result.current.snapshot?.summary.id).toBe("workspace-a"));

    act(() => {
      result.current.updateContent((current) => ({
        ...current,
        documents: current.documents.map((item) => item.id === document.id
          ? { ...item, title: "Editor update", updatedAt: 2000 }
          : item),
        updatedAt: 2000,
      }));
    });
    await act(async () => {
      await result.current.flushSave();
    });

    expect(result.current.saveStatus).toBe("remote");
    expect(documentRepository.save).toHaveBeenCalledWith(
      "public-document-a",
      expect.objectContaining({ title: "Editor update" }),
    );
  });

  it("keeps the snapshot empty when the initial catalog load fails", async () => {
    const workspaceA = createSnapshot("workspace-a", "Alpha", "owner", 1000);
    const repository = createRepository({
      catalog: createCatalog(workspaceA.summary),
      snapshots: { "workspace-a": workspaceA },
      target: "remote",
    });
    vi.mocked(repository.list).mockRejectedValueOnce(new Error("工作区目录加载失败"));
    const { result } = renderHook(() => useWorkspaceSession(repository));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(repository.load).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toBe("工作区目录加载失败");
  });

  it("waits for the latest old-workspace save before selecting a new workspace", async () => {
    const workspaceA = createSnapshot("workspace-a", "Alpha", "owner", 1000);
    const workspaceB = createSnapshot("workspace-b", "Beta", "owner", 1000);
    const saveDeferred = createDeferred<void>();
    const repository = createRepository({
      catalog: createCatalog(workspaceA.summary, workspaceB.summary),
      snapshots: { "workspace-a": workspaceA, "workspace-b": workspaceB },
      target: "remote",
    });
    vi.mocked(repository.save).mockReturnValueOnce(saveDeferred.promise);
    const { result } = renderHook(() => useWorkspaceSession(repository));
    await waitFor(() => expect(result.current.snapshot?.summary.id).toBe("workspace-a"));

    act(() => {
      result.current.updateContent((current) => ({ ...current, updatedAt: 2000 }));
    });
    let switching!: Promise<void>;
    act(() => {
      switching = result.current.switchWorkspace("workspace-b");
    });

    expect(repository.save).toHaveBeenCalledWith(
      "workspace-a",
      expect.objectContaining({ updatedAt: 2000 }),
    );
    expect(repository.select).not.toHaveBeenCalled();

    saveDeferred.resolve();
    await act(async () => {
      await switching;
    });

    expect(repository.select).toHaveBeenCalledWith("workspace-b");
    expect(result.current.snapshot).toEqual(workspaceB);
    expect(result.current.catalog?.currentWorkspaceId).toBe("workspace-b");
    expect(result.current.saveStatus).toBe("remote");
  });

  it("keeps the old snapshot when saving before a switch fails", async () => {
    const workspaceA = createSnapshot("workspace-a", "Alpha", "owner", 1000);
    const workspaceB = createSnapshot("workspace-b", "Beta", "owner", 1000);
    const saveDeferred = createDeferred<void>();
    const repository = createRepository({
      catalog: createCatalog(workspaceA.summary, workspaceB.summary),
      snapshots: { "workspace-a": workspaceA, "workspace-b": workspaceB },
      target: "remote",
    });
    vi.mocked(repository.save).mockReturnValueOnce(saveDeferred.promise);
    const { result } = renderHook(() => useWorkspaceSession(repository));
    await waitFor(() => expect(result.current.snapshot?.summary.id).toBe("workspace-a"));

    act(() => {
      result.current.updateContent((current) => ({ ...current, updatedAt: 2000 }));
    });
    let switching!: Promise<void>;
    act(() => {
      switching = result.current.switchWorkspace("workspace-b");
    });
    saveDeferred.reject(new Error("旧工作区保存失败"));
    await act(async () => {
      await switching;
    });

    expect(repository.select).not.toHaveBeenCalled();
    expect(result.current.snapshot?.summary.id).toBe("workspace-a");
    expect(result.current.saveStatus).toBe("failed");
    expect(result.current.error).toBe("旧工作区保存失败");
    expect(result.current.isTransitioning).toBe(false);
  });

  it("flushes the current save before installing a server transition", async () => {
    const workspaceA = createSnapshot("workspace-a", "Alpha", "owner", 1000);
    const workspaceB = createSnapshot("workspace-b", "Beta", "editor", 3000);
    const nextCatalog = createCatalog(workspaceB.summary, workspaceA.summary);
    const saveDeferred = createDeferred<void>();
    const repository = createRepository({
      catalog: createCatalog(workspaceA.summary),
      snapshots: { "workspace-a": workspaceA },
      target: "remote",
    });
    vi.mocked(repository.save).mockReturnValueOnce(saveDeferred.promise);
    const operation = vi.fn().mockResolvedValue({
      catalog: nextCatalog,
      workspace: workspaceB,
    });
    const { result } = renderHook(() => useWorkspaceSession(repository));
    await waitFor(() => expect(result.current.snapshot).toEqual(workspaceA));

    act(() => {
      result.current.updateContent((current) => ({ ...current, updatedAt: 2000 }));
    });
    let transitioning!: Promise<void>;
    act(() => {
      transitioning = result.current.runServerTransition(operation);
    });

    expect(result.current.isTransitioning).toBe(true);
    expect(repository.save).toHaveBeenCalledWith(
      "workspace-a",
      expect.objectContaining({ updatedAt: 2000 }),
    );
    expect(operation).not.toHaveBeenCalled();

    saveDeferred.resolve();
    await act(async () => {
      await transitioning;
    });

    expect(operation).toHaveBeenCalledTimes(1);
    expect(result.current.snapshot).toEqual(workspaceB);
    expect(result.current.catalog).toEqual(nextCatalog);
    expect(result.current.isTransitioning).toBe(false);
  });

  it("does not let a stale save overwrite a newly loaded readonly status", async () => {
    const workspaceA = createSnapshot("workspace-a", "Alpha", "owner", 1000);
    const workspaceB = createSnapshot("workspace-b", "Beta", "viewer", 1000);
    const saveDeferred = createDeferred<void>();
    const repository = createRepository({
      catalog: createCatalog(workspaceA.summary, workspaceB.summary),
      snapshots: { "workspace-a": workspaceA, "workspace-b": workspaceB },
      target: "remote",
    });
    vi.mocked(repository.save).mockReturnValueOnce(saveDeferred.promise);
    const { result } = renderHook(() => useWorkspaceSession(repository));
    await waitFor(() => expect(result.current.snapshot?.summary.id).toBe("workspace-a"));

    act(() => {
      result.current.updateContent((current) => ({ ...current, updatedAt: 2000 }));
    });
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.flushSave();
    });
    vi.mocked(repository.list).mockResolvedValueOnce(createCatalog(workspaceB.summary, workspaceA.summary));
    vi.mocked(repository.load).mockResolvedValueOnce(workspaceB);
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.saveStatus).toBe("readonly");

    saveDeferred.resolve();
    await act(async () => {
      await saving;
    });

    expect(result.current.snapshot).toEqual(workspaceB);
    expect(result.current.saveStatus).toBe("readonly");
  });

  it("does not carry a stale saved revision into a same-workspace reload", async () => {
    const workspaceA = createSnapshot("workspace-a", "Alpha", "owner", 1000);
    const reloadedA = createSnapshot("workspace-a", "Alpha reloaded", "owner", 3000);
    const saveDeferred = createDeferred<void>();
    const repository = createRepository({
      catalog: createCatalog(workspaceA.summary),
      snapshots: { "workspace-a": workspaceA },
      target: "remote",
    });
    vi.mocked(repository.save)
      .mockReturnValueOnce(saveDeferred.promise)
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useWorkspaceSession(repository));
    await waitFor(() => expect(result.current.snapshot).toEqual(workspaceA));

    act(() => {
      result.current.updateContent((current) => ({ ...current, updatedAt: 2000 }));
    });
    let staleSave!: Promise<void>;
    act(() => {
      staleSave = result.current.flushSave();
    });
    vi.mocked(repository.list).mockResolvedValueOnce(createCatalog(reloadedA.summary));
    vi.mocked(repository.load).mockResolvedValueOnce(reloadedA);
    await act(async () => {
      await result.current.reload();
    });

    saveDeferred.resolve();
    await act(async () => {
      await staleSave;
    });
    act(() => {
      result.current.updateContent((current) => ({ ...current, updatedAt: 4000 }));
    });
    await act(async () => {
      await result.current.flushSave();
    });

    expect(repository.save).toHaveBeenCalledTimes(2);
    expect(repository.save).toHaveBeenLastCalledWith(
      "workspace-a",
      expect.objectContaining({ updatedAt: 4000 }),
    );
  });

  it("creates and renames workspaces while viewer updates remain readonly", async () => {
    const workspaceA = createSnapshot("workspace-a", "Alpha", "owner", 1000);
    const workspaceB = createSnapshot("workspace-b", "Beta", "viewer", 1000);
    const repository = createRepository({
      catalog: createCatalog(workspaceA.summary, workspaceB.summary),
      snapshots: { "workspace-a": workspaceA, "workspace-b": workspaceB },
      target: "local",
    });
    const created = createSnapshot("workspace-c", "Gamma", "owner", 2000);
    vi.mocked(repository.create).mockResolvedValueOnce(created);
    vi.mocked(repository.rename).mockResolvedValueOnce({ ...created.summary, name: "研发中心" });
    const { result } = renderHook(() => useWorkspaceSession(repository));
    await waitFor(() => expect(result.current.snapshot?.summary.id).toBe("workspace-a"));

    await act(async () => {
      await result.current.createWorkspace("Gamma");
    });
    expect(result.current.snapshot).toEqual(created);
    expect(result.current.catalog?.currentWorkspaceId).toBe("workspace-c");

    await act(async () => {
      await result.current.renameWorkspace("workspace-c", "研发中心");
    });
    expect(result.current.snapshot?.summary.name).toBe("研发中心");
    expect(result.current.catalog?.workspaces[0].name).toBe("研发中心");

    vi.mocked(repository.select).mockResolvedValueOnce(workspaceB);
    await act(async () => {
      await result.current.switchWorkspace("workspace-b");
    });
    const viewerContent = result.current.snapshot!.content;
    act(() => {
      result.current.updateContent((current) => ({ ...current, updatedAt: 9000 }));
    });
    await act(async () => {
      await result.current.flushSave();
    });
    expect(result.current.snapshot?.content).toEqual(viewerContent);
    expect(result.current.saveStatus).toBe("readonly");
    expect(repository.save).not.toHaveBeenCalled();
  });
});

function createRepository({
  catalog,
  snapshots,
  target,
}: {
  catalog: WorkspaceCatalog;
  snapshots: Record<string, WorkspaceSnapshot>;
  target: WorkspaceRepository["target"];
}): WorkspaceRepository {
  return {
    target,
    list: vi.fn().mockResolvedValue(catalog),
    load: vi.fn((workspaceId: string) => Promise.resolve(snapshots[workspaceId])),
    create: vi.fn(),
    rename: vi.fn(),
    select: vi.fn((workspaceId: string) => Promise.resolve(snapshots[workspaceId])),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

function createDocumentRepository(
  snapshot: Awaited<ReturnType<DocumentRepository["load"]>>,
): DocumentRepository {
  return {
    load: vi.fn().mockResolvedValue(snapshot),
    loadPolicy: vi.fn(),
    save: vi.fn().mockResolvedValue(snapshot),
    updatePolicy: vi.fn(),
  };
}

function createSnapshot(
  id: string,
  name: string,
  role: WorkspaceSummary["role"],
  updatedAt: number,
): WorkspaceSnapshot {
  return {
    content: createDefaultWorkspace(updatedAt),
    summary: {
      createdAt: updatedAt,
      id,
      name,
      role,
      updatedAt,
    },
  };
}

function createCatalog(...workspaces: WorkspaceSummary[]): WorkspaceCatalog {
  return {
    currentWorkspaceId: workspaces[0].id,
    workspaces,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
