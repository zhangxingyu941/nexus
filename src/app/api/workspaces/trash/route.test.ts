import { describe, expect, it, vi } from "vitest";
import { createPostgresServices } from "@/server/applicationServices";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { GET } from "./route";

vi.mock("@/server/applicationServices", () => ({
  createPostgresServices: vi.fn(),
}));

vi.mock("@/server/database/pool", () => ({
  hasDatabaseConfiguration: vi.fn(),
}));

describe("workspace trash route", () => {
  it("returns owner tombstones in the workspaces envelope", async () => {
    vi.mocked(hasDatabaseConfiguration).mockReturnValue(true);
    const workspaces = [{
      deletedAt: 2_000,
      deletedBy: { displayName: "Owner", id: "owner-1" },
      id: "workspace-1",
      name: "Product centre",
      purgeAfter: 4_000,
    }];
    vi.mocked(createPostgresServices).mockReturnValue({
      authStore: {
        getUserBySessionToken: vi.fn().mockResolvedValue({ id: "owner-1" }),
      },
      workspaceLifecycleStore: {
        listTrash: vi.fn().mockResolvedValue(workspaces),
      },
      workspaceStore: {},
    } as never);

    const response = await GET(new Request("http://localhost/api/workspaces/trash", {
      headers: { Cookie: "notion_editor_session=session-token" },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ workspaces });
  });
});
