import { useCallback, useMemo } from "react";
import type { EditorDocument } from "../../model/block";
import type { DatabaseWorkspaceMember } from "../../session/sessionTypes";

export interface MentionItem {
  id: string;
  kind: "person" | "document" | "task" | "date";
  label: string;
  subtext?: string;
}

interface MentionSearchTask {
  content: string;
  id: string;
  status: string;
}

function formatDate(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}月${day}日`;
}

function searchItems(
  query: string,
  members: DatabaseWorkspaceMember[],
  documents: EditorDocument[],
  tasks: MentionSearchTask[],
): MentionItem[] {
  const normalizedQuery = query.toLowerCase().trim();

  if (!normalizedQuery) {
    return [];
  }

  const results: MentionItem[] = [];

  // 搜索成员
  for (const member of members) {
    const name = (member.displayName || member.email).toLowerCase();
    if (name.includes(normalizedQuery)) {
      results.push({
        id: member.id,
        kind: "person",
        label: member.displayName || member.email,
        subtext: member.email !== member.displayName ? member.email : undefined,
      });
    }
  }

  // 搜索文档
  for (const doc of documents) {
    const title = (doc.title || "未命名文档").toLowerCase();
    if (title.includes(normalizedQuery)) {
      results.push({
        id: doc.id,
        kind: "document",
        label: doc.title || "未命名文档",
        subtext: `${doc.blocks.length} 个块`,
      });
    }
  }

  // 搜索任务
  for (const task of tasks) {
    const content = task.content.toLowerCase();
    if (content.includes(normalizedQuery)) {
      results.push({
        id: task.id,
        kind: "task",
        label: task.content || "未命名任务",
        subtext: task.status === "done" ? "已完成" : "待办",
      });
    }
  }

  // 添加当前日期
  const today = formatDate(new Date());
  if (today.toLowerCase().includes(normalizedQuery)) {
    results.push({
      id: `date-${Date.now()}`,
      kind: "date",
      label: today,
      subtext: "今天",
    });
  }

  return results;
}

export function useMentionSearch({
  query,
  members,
  documents,
  tasks,
}: {
  query: string;
  members: DatabaseWorkspaceMember[];
  documents: EditorDocument[];
  tasks: MentionSearchTask[];
}): MentionItem[] {
  return useMemo(
    () => searchItems(query, members, documents, tasks),
    [query, members, documents, tasks],
  );
}

export function useMentionSearchFn({
  members,
  documents,
  tasks,
}: {
  members: DatabaseWorkspaceMember[];
  documents: EditorDocument[];
  tasks: MentionSearchTask[];
}): (query: string) => MentionItem[] {
  return useCallback(
    (query: string) => searchItems(query, members, documents, tasks),
    [members, documents, tasks],
  );
}
