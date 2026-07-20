import { afterEach, describe, expect, it, vi } from "vitest";
import {
  workspaceLifecycleRepository,
} from "./workspaceLifecycleRepository";

describe("workspace lifecycle repository", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the exact deletion, trash, and restore endpoints", async () => {
    const summary = {
      documentCount: 2,
      fileCount: 3,
      id: "workspace/a",
      memberCount: 4,
      name: "产品研发中心",
    };
    const transition = {
      catalog: { currentWorkspaceId: "workspace-b", workspaces: [] },
      deletedWorkspace: {
        deletedAt: 1_000,
        deletedBy: null,
        id: "workspace/a",
        name: "产品研发中心",
        purgeAfter: 2_000,
      },
      workspace: { content: {}, summary: { id: "workspace-b" } },
    };
    const restored = {
      catalog: { currentWorkspaceId: "workspace/a", workspaces: [] },
      workspace: { content: {}, summary: { id: "workspace/a" } },
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ summary }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(transition), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ workspaces: [transition.deletedWorkspace] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(restored), { status: 200 }));

    await expect(workspaceLifecycleRepository.summary("workspace/a")).resolves.toEqual(summary);
    await expect(workspaceLifecycleRepository.delete("workspace/a", "产品研发中心"))
      .resolves.toEqual(transition);
    await expect(workspaceLifecycleRepository.listTrash())
      .resolves.toEqual([transition.deletedWorkspace]);
    await expect(workspaceLifecycleRepository.restore("workspace/a")).resolves.toEqual(restored);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/workspaces/workspace%2Fa/deletion-summary",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/workspaces/workspace%2Fa",
      expect.objectContaining({
        body: JSON.stringify({ confirmationName: "产品研发中心" }),
        method: "DELETE",
      }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/workspaces/trash",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "/api/workspaces/workspace%2Fa/restore",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
