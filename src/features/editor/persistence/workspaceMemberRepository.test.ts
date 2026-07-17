import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadWorkspaceMembers,
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
});
