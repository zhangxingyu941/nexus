import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultWorkspace } from "../model/workspaceOperations";
import { createRemoteWorkspaceRepository } from "./remoteWorkspaceRepository";

const content = createDefaultWorkspace(1000);
const summary = {
  createdAt: 1000,
  id: "workspace/a",
  name: "产品团队",
  role: "owner" as const,
  updatedAt: 1000,
};
const snapshot = { content, summary };

describe("remote workspace repository", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists and loads workspaces with explicit encoded IDs", async () => {
    const catalog = { currentWorkspaceId: summary.id, workspaces: [summary] };
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(jsonResponse(catalog))
      .mockResolvedValueOnce(jsonResponse(snapshot));
    vi.stubGlobal("fetch", fetchSpy);
    const repository = createRemoteWorkspaceRepository();

    await expect(repository.list()).resolves.toEqual(catalog);
    await expect(repository.load("workspace/a")).resolves.toEqual(snapshot);
    expect(fetchSpy).toHaveBeenNthCalledWith(1, "/api/workspaces", expect.objectContaining({ method: "GET" }));
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/workspaces/workspace%2Fa",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("creates, renames, selects, and saves through the REST contract", async () => {
    const renamed = { ...summary, name: "研发中心" };
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(jsonResponse(snapshot, 201))
      .mockResolvedValueOnce(jsonResponse({ workspace: renamed }))
      .mockResolvedValueOnce(jsonResponse(snapshot))
      .mockResolvedValueOnce(jsonResponse({ saved: true }));
    vi.stubGlobal("fetch", fetchSpy);
    const repository = createRemoteWorkspaceRepository();

    await expect(repository.create("产品团队")).resolves.toEqual(snapshot);
    await expect(repository.rename("workspace/a", "研发中心")).resolves.toEqual(renamed);
    await expect(repository.select("workspace-2")).resolves.toEqual(snapshot);
    await expect(repository.save("workspace/a", content)).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/workspaces",
      expect.objectContaining({ body: JSON.stringify({ name: "产品团队" }), method: "POST" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/workspaces/workspace%2Fa",
      expect.objectContaining({ body: JSON.stringify({ name: "研发中心" }), method: "PATCH" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/workspaces/workspace-2/select",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "/api/workspaces/workspace%2Fa",
      expect.objectContaining({ body: JSON.stringify({ content }), method: "PUT" }),
    );
  });

  it("surfaces server errors and rejects invalid JSON responses", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "工作区不存在" }, 404))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const repository = createRemoteWorkspaceRepository();

    await expect(repository.load("missing")).rejects.toThrow("工作区不存在");
    await expect(repository.list()).rejects.toThrow("工作区服务返回无效响应");
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
