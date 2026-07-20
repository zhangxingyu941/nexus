import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMentionSearch } from "./useMentionSearch";
import type { Block, EditorDocument } from "../../model/block";
import type { DatabaseWorkspaceMember } from "../../session/sessionTypes";

const members: DatabaseWorkspaceMember[] = [
  { id: "user-1", email: "alice@example.com", displayName: "Alice", role: "owner" },
];

const documents: EditorDocument[] = [
  { id: "doc-1", title: "设计文档", blocks: [], createdAt: 0, updatedAt: 0, parentId: null },
];

const tasks: Block[] = [
  { id: "task-1", type: "todo", headingLevel: 1, content: "实现登录", parentId: null, children: [], checked: false, data: null, comments: [], assignee: "", dueDate: "", status: "unset", createdAt: 0, updatedAt: 0 },
];

describe("useMentionSearch", () => {
  it("returns empty array for empty query", () => {
    const { result } = renderHook(() => useMentionSearch({ query: "", members, documents, tasks }));
    expect(result.current).toEqual([]);
  });

  it("searches members by display name", () => {
    const { result } = renderHook(() => useMentionSearch({ query: "ali", members, documents, tasks }));
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ kind: "person", label: "Alice" });
  });

  it("searches documents by title", () => {
    const { result } = renderHook(() => useMentionSearch({ query: "设计", members, documents, tasks }));
    expect(result.current.some((r) => r.kind === "document" && r.label === "设计文档")).toBe(true);
  });

  it("searches tasks by content", () => {
    const { result } = renderHook(() => useMentionSearch({ query: "登录", members, documents, tasks }));
    expect(result.current.some((r) => r.kind === "task" && r.label === "实现登录")).toBe(true);
  });

  it("includes current date when query matches", () => {
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    const query = `${month}月${day}日`;
    const { result } = renderHook(() => useMentionSearch({ query, members, documents, tasks }));
    expect(result.current.some((r) => r.kind === "date")).toBe(true);
  });
});
