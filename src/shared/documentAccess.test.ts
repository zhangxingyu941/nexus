import { describe, expect, it } from "vitest";
import {
  isDocumentAccessMode,
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
});
