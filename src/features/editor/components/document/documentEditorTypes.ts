import type { BlockComment, EditorDocument } from "../../model/block";

export const SAVE_STATUS_LABELS = {
  failed: "保存失败",
  local: "本地已保存",
  readonly: "只读",
  remote: "已同步",
  saving: "保存中",
  unsaved: "未保存",
} as const;

export type SaveStatus = keyof typeof SAVE_STATUS_LABELS;
export type SharePermission = "private" | "team" | "link";
export type CommentFilter = "open" | "all";
export const COLLABORATION_STATUS_LABELS = {
  connected: "协同已连接",
  connecting: "协同连接中",
  disabled: "协同未启用",
  offline: "协同离线",
} as const;

export interface BlockCommentView extends BlockComment {
  blockId: string;
  blockPreview: string;
}

export function getDocumentTitle(document: EditorDocument) {
  return document.title.trim() || "未命名文档";
}

export function getBlockPreview(content: string) {
  return content.trim() || "空白块";
}

export function scrollToBlock(blockId: string) {
  document.querySelector(`[data-testid="block-row-${blockId}"]`)?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}
