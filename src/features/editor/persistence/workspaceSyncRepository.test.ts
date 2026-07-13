import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultWorkspace, createWorkspaceDocument } from "../model/workspaceOperations";
import {
  clearDocument,
  clearWorkspace,
  loadWorkspace as loadLocalWorkspace,
} from "./editorRepository";
import {
  addWorkspaceMember,
  loadSyncedWorkspace,
  loadWorkspaceMembers,
  saveSyncedWorkspace,
} from "./workspaceSyncRepository";

describe("workspace sync repository", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await clearWorkspace();
    await clearDocument();
  });

  it("loads the workspace from the backend api first", async () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000, "后端文档");
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ workspace }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(loadSyncedWorkspace()).resolves.toEqual({
      source: "remote",
      workspace,
    });
    expect(fetchSpy).toHaveBeenCalledWith("/api/workspace", expect.objectContaining({ method: "GET" }));
  });

  it("falls back to IndexedDB when the backend api cannot be reached", async () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000, "本地兜底文档");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("backend offline")));
    await saveSyncedWorkspace(workspace);

    await expect(loadSyncedWorkspace()).resolves.toEqual({
      source: "local",
      workspace,
    });
  });

  it("saves remotely and mirrors the workspace into IndexedDB", async () => {
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000, "双写文档");
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ saved: true, workspace }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(saveSyncedWorkspace(workspace)).resolves.toBe("remote");

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/workspace",
      expect.objectContaining({
        body: JSON.stringify({ workspace }),
        method: "PUT",
      }),
    );
    await expect(loadLocalWorkspace()).resolves.toEqual(workspace);
  });

  it("returns database access metadata and loads persisted members", async () => {
    const workspace = createDefaultWorkspace(1000);
    const owner = { displayName: "林夏", email: "owner@example.com", id: "owner-1" };
    const members = [
      { ...owner, role: "owner" },
    ];
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ role: "owner", user: owner, workspace }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ members }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(loadSyncedWorkspace()).resolves.toEqual({
      role: "owner",
      source: "remote",
      user: owner,
      workspace,
    });
    await expect(loadWorkspaceMembers()).resolves.toEqual(members);
  });

  it("adds a database workspace member and returns the updated list", async () => {
    const members = [
      { displayName: "周宁", email: "editor@example.com", id: "editor-1", role: "editor" },
    ];
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ members }), {
        headers: { "Content-Type": "application/json" },
        status: 201,
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(addWorkspaceMember("editor@example.com", "editor")).resolves.toEqual(members);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/workspace/members",
      expect.objectContaining({
        body: JSON.stringify({ email: "editor@example.com", role: "editor" }),
        method: "POST",
      }),
    );
  });
});
