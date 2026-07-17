import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { notifyWorkspaceAccessInvalidation } from "./workspaceAccessNotifications";

describe("workspace access notifications", () => {
  it("serializes the invalidation event as JSON for pg_notify", async () => {
    const query = vi.fn().mockResolvedValue({ command: "SELECT" });
    await notifyWorkspaceAccessInvalidation({ query } as never, {
      userId: "user-1",
      workspaceId: "workspace-1",
    });

    expect(query).toHaveBeenCalledWith("SELECT pg_notify($1,$2)", [
      "workspace_access_invalidated",
      JSON.stringify({ userId: "user-1", workspaceId: "workspace-1" }),
    ]);
  });

  it("supports null userId for workspace-level invalidation", async () => {
    const query = vi.fn().mockResolvedValue({ command: "SELECT" });
    await notifyWorkspaceAccessInvalidation({ query } as never, {
      userId: null,
      workspaceId: "workspace-1",
    });

    expect(query).toHaveBeenCalledWith("SELECT pg_notify($1,$2)", [
      "workspace_access_invalidated",
      JSON.stringify({ userId: null, workspaceId: "workspace-1" }),
    ]);
  });
});
