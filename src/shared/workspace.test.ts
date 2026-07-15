import { describe, expect, it } from "vitest";
import {
  normalizeWorkspaceName,
  sortWorkspaceSummaries,
  WorkspaceNameValidationError,
} from "./workspace";

describe("workspace contract", () => {
  it("trims valid names and rejects empty or overlong names", () => {
    expect(normalizeWorkspaceName("  产品团队  ")).toBe("产品团队");
    expect(() => normalizeWorkspaceName("   ")).toThrow(WorkspaceNameValidationError);
    expect(() => normalizeWorkspaceName("x".repeat(81))).toThrow(WorkspaceNameValidationError);
  });

  it("places the selected workspace first and keeps the rest stable", () => {
    const result = sortWorkspaceSummaries(
      [
        { id: "b", name: "B", role: "editor", createdAt: 20, updatedAt: 20 },
        { id: "a", name: "A", role: "owner", createdAt: 10, updatedAt: 10 },
      ],
      "b",
    );
    expect(result.map((item) => item.id)).toEqual(["b", "a"]);
  });
});
