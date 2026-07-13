import type { ReactNode } from "react";
import type { EditorDocument } from "../../model/block";

export const TASK_STATUS_LABELS = {
  all: "全部",
  open: "未完成",
  done: "已完成",
  "in-progress": "进行中",
  review: "待评审",
  todo: "待处理",
  unset: "未设置",
} as const;

export type TaskStatusFilter = keyof typeof TASK_STATUS_LABELS;

export function getDocumentTitle(document: EditorDocument) {
  return document.title.trim() || "未命名文档";
}

export function renderHighlightedTitle(title: string, query: string): ReactNode {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return title;
  }

  const startIndex = title.toLowerCase().indexOf(normalizedQuery);

  if (startIndex === -1) {
    return title;
  }

  const before = title.slice(0, startIndex);
  const match = title.slice(startIndex, startIndex + query.trim().length);
  const after = title.slice(startIndex + query.trim().length);

  return (
    <>
      {before}
      <mark className="search-highlight">{match}</mark>
      {after}
    </>
  );
}
