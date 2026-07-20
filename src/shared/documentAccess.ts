export const DOCUMENT_ACCESS_MODES = ["workspace", "private", "link"] as const;
export const DOCUMENT_PERMISSION_ROLES = ["editor", "viewer"] as const;

export type DocumentAccessMode = (typeof DOCUMENT_ACCESS_MODES)[number];
export type DocumentPermissionRole = (typeof DOCUMENT_PERMISSION_ROLES)[number];
export type DocumentAction = "read" | "write" | "manage";

export interface DocumentAccess {
  accessMode: DocumentAccessMode;
  canManage: boolean;
  canRead: boolean;
  canWrite: boolean;
  documentId: string;
  role: "owner" | "editor" | "viewer" | "none";
  source: "workspace-owner" | "author" | "explicit" | "workspace";
  workspaceId: string;
}

export function isDocumentAccessMode(value: unknown): value is DocumentAccessMode {
  return typeof value === "string" && DOCUMENT_ACCESS_MODES.includes(value as DocumentAccessMode);
}

export function isDocumentPermissionRole(value: unknown): value is DocumentPermissionRole {
  return typeof value === "string" && DOCUMENT_PERMISSION_ROLES.includes(value as DocumentPermissionRole);
}
