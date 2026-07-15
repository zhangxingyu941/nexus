import { describe, expect, it } from "vitest";
import {
  normalizeWorkspaceName,
  sortWorkspaceSummaries,
  type WorkspaceSummary,
  WorkspaceNameValidationError,
} from "./workspace";

describe("workspace contract", () => {
  it("trims valid names and rejects empty or overlong names", () => {
    expect(normalizeWorkspaceName("  产品团队  ")).toBe("产品团队");
    expect(() => normalizeWorkspaceName("   ")).toThrow(WorkspaceNameValidationError);
    expect(() => normalizeWorkspaceName("x".repeat(81))).toThrow(WorkspaceNameValidationError);
  });

  it("places the selected workspace first, sorts the rest deterministically, and preserves input", () => {
    const items: WorkspaceSummary[] = [
      { id: "z", name: "Z", role: "viewer", createdAt: 20, updatedAt: 20 },
      { id: "selected", name: "Selected", role: "owner", createdAt: 30, updatedAt: 30 },
      { id: "b", name: "B", role: "editor", createdAt: 10, updatedAt: 10 },
      { id: "a", name: "A", role: "editor", createdAt: 10, updatedAt: 10 },
      { id: "m", name: "M", role: "viewer", createdAt: 15, updatedAt: 15 },
    ];
    const originalItems = items.map((item) => ({ ...item }));

    const result = sortWorkspaceSummaries(items, "selected");

    expect(result.map((item) => item.id)).toEqual(["selected", "a", "b", "m", "z"]);
    expect(items).toEqual(originalItems);
  });
});
