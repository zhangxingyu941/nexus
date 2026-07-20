import { afterEach, describe, expect, it, vi } from "vitest";
import {
  leaveWorkspace,
  loadWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from "./workspaceMemberRepository";

describe("workspace member repository", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads members from the explicitly encoded workspace path", async () => {
    const members = [
      {
        displayName: "林夏",
        email: "owner@example.com",
        id: "owner-1",
        role: "owner" as const,
      },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ members }), { status: 200 }),
    );

    await expect(loadWorkspaceMembers("workspace/a")).resolves.toEqual(members);
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/workspaces/workspace%2Fa/members",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("uses PATCH, DELETE, and the dedicated leave route", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    await updateWorkspaceMemberRole("workspace/a", "user/b", "viewer");
    await removeWorkspaceMember("workspace/a", "user/b");
    const transition = {
      catalog: { currentWorkspaceId: "ws-1", workspaces: [] },
      workspace: { content: {}, summary: { id: "ws-1" } },
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(transition), { status: 200 }),
    );
    await expect(leaveWorkspace("workspace/a")).resolves.toEqual(transition);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/workspaces/workspace%2Fa/members/user%2Fb",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/workspaces/workspace%2Fa/members/user%2Fb",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/workspaces/workspace%2Fa/leave",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
