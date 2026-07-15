import { describe, expect, it } from "vitest";
import {
  normalizeWorkspaceName,
  sortWorkspaceSummaries,
  type WorkspaceSummary,
  WorkspaceNameValidationError,
} from "./workspace";

describe("workspace contract", () => {
  it("trims valid names and enforces the name validation contract", () => {
    expect(normalizeWorkspaceName("  产品团队  ")).toBe("产品团队");
    expect(normalizeWorkspaceName("x".repeat(80))).toBe("x".repeat(80));

    let validationError: unknown;
    try {
      normalizeWorkspaceName("   ");
    } catch (error) {
      validationError = error;
    }

    expect(validationError).toBeInstanceOf(WorkspaceNameValidationError);
    expect((validationError as Error).name).toBe("WorkspaceNameValidationError");
    expect((validationError as Error).message).toBe("工作区名称长度必须为 1-80 个字符");
    expect(() => normalizeWorkspaceName("   ")).toThrow(WorkspaceNameValidationError);
    expect(() => normalizeWorkspaceName("x".repeat(81))).toThrow(WorkspaceNameValidationError);
    expect(() => normalizeWorkspaceName(42)).toThrow(WorkspaceNameValidationError);
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

  it("preserves the relative order of duplicate selected workspace summaries", () => {
    const result = sortWorkspaceSummaries(
      [
        { id: "other", name: "Other", role: "viewer", createdAt: 10, updatedAt: 10 },
        { id: "selected", name: "First selected", role: "owner", createdAt: 20, updatedAt: 20 },
        { id: "selected", name: "Second selected", role: "editor", createdAt: 30, updatedAt: 30 },
      ],
      "selected",
    );

    expect(result.map((item) => item.name)).toEqual(["First selected", "Second selected", "Other"]);
  });

  it("uses code-unit ID ordering when the selected workspace is missing", () => {
    const result = sortWorkspaceSummaries(
      [
        { id: "a", name: "Lowercase", role: "viewer", createdAt: 10, updatedAt: 10 },
        { id: "Z", name: "Uppercase", role: "viewer", createdAt: 10, updatedAt: 10 },
      ],
      "missing",
    );

    expect(result.map((item) => item.id)).toEqual(["Z", "a"]);
  });
});
