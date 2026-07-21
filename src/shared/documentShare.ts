import type {
  AttachmentBlockData,
  BlockData,
  BlockType,
  HeadingLevel,
} from "../features/editor/model/block";

export const DEFAULT_DOCUMENT_SHARE_TTL_MS = 24 * 60 * 60_000;
export const MAX_DOCUMENT_SHARE_TTL_MS = 365 * 24 * 60 * 60_000;

export const DOCUMENT_SHARE_PRESETS = [
  { label: "1 小时", milliseconds: 60 * 60_000 },
  { label: "24 小时", milliseconds: DEFAULT_DOCUMENT_SHARE_TTL_MS },
  { label: "7 天", milliseconds: 7 * 24 * 60 * 60_000 },
  { label: "30 天", milliseconds: 30 * 24 * 60 * 60_000 },
] as const;

export type DocumentShareStatus = "active" | "expired";

export interface DocumentShareSummary {
  expiresAt: number;
  id: string;
  status: DocumentShareStatus;
}

export interface CreatedDocumentShare extends DocumentShareSummary {
  url: string;
}

export type SharedBlockData =
  | Exclude<BlockData, AttachmentBlockData>
  | Omit<AttachmentBlockData, "key">;

export interface SharedBlock {
  children: string[];
  content: string;
  data: SharedBlockData | null;
  headingLevel: HeadingLevel;
  id: string;
  parentId: string | null;
  type: BlockType;
}

export interface SharedDocumentSnapshot {
  document: {
    blocks: SharedBlock[];
    title: string;
  };
  expiresAt: number;
}

export function resolveDocumentShareExpiresAt(value: unknown, now = Date.now()) {
  const expiresAt = value === undefined
    ? now + DEFAULT_DOCUMENT_SHARE_TTL_MS
    : value;

  if (!Number.isSafeInteger(expiresAt) || (expiresAt as number) <= now) {
    throw new TypeError("分享过期时间必须晚于当前时间");
  }
  if ((expiresAt as number) > now + MAX_DOCUMENT_SHARE_TTL_MS) {
    throw new TypeError("分享有效期不能超过 365 天");
  }

  return expiresAt as number;
}
