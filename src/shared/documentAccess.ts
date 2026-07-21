export const DOCUMENT_ACCESS_MODES = ["workspace", "private", "link"] as const;
export const DOCUMENT_PERMISSION_ROLES = ["editor", "viewer"] as const;

export type DocumentAccessMode = (typeof DOCUMENT_ACCESS_MODES)[number];
export type DocumentPermissionRole = (typeof DOCUMENT_PERMISSION_ROLES)[number];
export type DocumentAction = "read" | "write" | "manage";

export interface DocumentPermission {
  role: DocumentPermissionRole;
  userId: string;
}

export interface DocumentPolicy {
  accessMode: DocumentAccessMode;
  permissions: DocumentPermission[];
}

export interface DocumentAccess {
  accessMode: DocumentAccessMode;
  canManage: boolean;
  canRead: boolean;
  canWrite: boolean;
  documentId: string;
  publicId: string;
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

export function isDocumentPolicy(value: unknown): value is DocumentPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const input = value as { accessMode?: unknown; permissions?: unknown };
  if (
    !isDocumentAccessMode(input.accessMode) ||
    !Array.isArray(input.permissions)
  ) {
    return false;
  }

  const userIds = new Set<string>();
  return input.permissions.every((permission) => {
    if (!permission || typeof permission !== "object" || Array.isArray(permission)) return false;
    const inputPermission = permission as { role?: unknown; userId?: unknown };
    if (
      typeof inputPermission.userId !== "string" ||
      !inputPermission.userId ||
      !isDocumentPermissionRole(inputPermission.role) ||
      userIds.has(inputPermission.userId)
    ) {
      return false;
    }
    userIds.add(inputPermission.userId);
    return true;
  });
}
