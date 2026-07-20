import { describe, expect, it, vi } from "vitest";
import { WorkspacePurgeService } from "./workspacePurgeService";

describe("WorkspacePurgeService", () => {
  it("deletes objects before the database row", async () => {
    const calls: string[] = [];
    const purgeDatabaseRow = vi.fn(async () => {
      calls.push("database");
      return true;
    });
    const release = vi.fn(async () => undefined);
    const lifecycleStore = {
      claimExpiredWorkspace: vi.fn().mockResolvedValue({
        candidate: { id: "workspace-1", name: "Product" },
        purgeDatabaseRow,
        release,
      }),
      listExpiredPurgeCandidates: vi.fn().mockResolvedValue([
        { id: "workspace-1", name: "Product" },
      ]),
    };
    const objectStorage = {
      deletePrefix: vi.fn(async () => {
        calls.push("objects");
      }),
    };
    const service = new WorkspacePurgeService({ lifecycleStore, objectStorage });

    await service.purgeExpired(3);

    expect(calls).toEqual(["objects", "database"]);
    expect(objectStorage.deletePrefix).toHaveBeenCalledWith("workspace-1/");
    expect(release).toHaveBeenCalledOnce();
  });

  it("retains the tombstone when object deletion fails", async () => {
    const purgeDatabaseRow = vi.fn();
    const release = vi.fn(async () => undefined);
    const logger = { error: vi.fn() };
    const lifecycleStore = {
      claimExpiredWorkspace: vi.fn().mockResolvedValue({
        candidate: { id: "workspace-1", name: "Product" },
        purgeDatabaseRow,
        release,
      }),
      listExpiredPurgeCandidates: vi.fn().mockResolvedValue([
        { id: "workspace-1", name: "Product" },
      ]),
    };
    const objectStorage = {
      deletePrefix: vi.fn().mockRejectedValue(new Error("storage down")),
    };
    const service = new WorkspacePurgeService({ lifecycleStore, logger, objectStorage });

    await service.purgeExpired(3);

    expect(purgeDatabaseRow).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith("workspace_purge_failed", {
      error: "storage down",
      phase: "objects",
      workspaceId: "workspace-1",
    });
  });

  it("records database failures separately after object deletion", async () => {
    const logger = { error: vi.fn() };
    const release = vi.fn(async () => undefined);
    const lifecycleStore = {
      claimExpiredWorkspace: vi.fn().mockResolvedValue({
        candidate: { id: "workspace-1", name: "Product" },
        purgeDatabaseRow: vi.fn().mockRejectedValue(new Error("database down")),
        release,
      }),
      listExpiredPurgeCandidates: vi.fn().mockResolvedValue([
        { id: "workspace-1", name: "Product" },
      ]),
    };
    const service = new WorkspacePurgeService({
      lifecycleStore,
      logger,
      objectStorage: { deletePrefix: vi.fn().mockResolvedValue(undefined) },
    });

    await service.purgeExpired(3);

    expect(logger.error).toHaveBeenCalledWith("workspace_purge_failed", {
      error: "database down",
      phase: "database",
      workspaceId: "workspace-1",
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it("limits every request purge to three candidates", async () => {
    const lifecycleStore = {
      claimExpiredWorkspace: vi.fn(),
      listExpiredPurgeCandidates: vi.fn().mockResolvedValue([]),
    };
    const service = new WorkspacePurgeService({
      lifecycleStore,
      objectStorage: { deletePrefix: vi.fn() },
    });

    await service.purgeExpired(99);

    expect(lifecycleStore.listExpiredPurgeCandidates).toHaveBeenCalledWith(3);
  });
});
