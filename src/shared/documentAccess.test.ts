import { describe, expect, it } from "vitest";
import {
  isDocumentAccessMode,
  isDocumentPolicy,
  isDocumentPermissionRole,
} from "./documentAccess";

describe("document access contracts", () => {
  it("accepts only persisted policy values", () => {
    expect(isDocumentAccessMode("workspace")).toBe(true);
    expect(isDocumentAccessMode("private")).toBe(true);
    expect(isDocumentAccessMode("link")).toBe(true);
    expect(isDocumentAccessMode("public")).toBe(false);
    expect(isDocumentPermissionRole("editor")).toBe(true);
    expect(isDocumentPermissionRole("viewer")).toBe(true);
    expect(isDocumentPermissionRole("owner")).toBe(false);
  });

  it("accepts only unique persisted permission policies", () => {
    expect(isDocumentPolicy({
      accessMode: "private",
      permissions: [{ role: "viewer", userId: "user-1" }],
    })).toBe(true);
    expect(isDocumentPolicy({ accessMode: "link", permissions: [] })).toBe(true);
    expect(isDocumentPolicy({
      accessMode: "workspace",
      permissions: [
        { role: "viewer", userId: "user-1" },
        { role: "editor", userId: "user-1" },
      ],
    })).toBe(false);
  });
});
