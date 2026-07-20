import type { DocumentAccess } from "../shared/documentAccess";
import { getSessionToken } from "./sessionCookie";

interface CollaborationAuthStore {
  getUserBySessionToken(token: string): Promise<{ id: string } | null>;
}

interface CollaborationDocumentAuthorization {
  requireWorkspaceDocumentAction(
    userId: string,
    workspaceId: string,
    documentId: string,
    action: "write",
  ): Promise<DocumentAccess>;
}

interface CollaborationAuthorizationDependencies {
  authStore: CollaborationAuthStore;
  documentAuthorization: CollaborationDocumentAuthorization;
}

export type CollaborationAuthorizationResult =
  | {
      access: DocumentAccess;
      documentId: string;
      ok: true;
      roomName: string;
      userId: string;
    }
  | {
      message: string;
      ok: false;
      status: 400 | 401 | 403;
    };

function getRoomName(request: Request) {
  const path = new URL(request.url).pathname.slice(1);
  try {
    return decodeURIComponent(path);
  } catch {
    return "";
  }
}

export async function authorizeCollaborationRequest(
  request: Request,
  { authStore, documentAuthorization }: CollaborationAuthorizationDependencies,
): Promise<CollaborationAuthorizationResult> {
  const roomName = getRoomName(request);
  const roomMatch = /^workspace:([^:/]+):document:([^:/]+)$/.exec(roomName);
  if (!roomMatch) {
    return { message: "协作房间无效", ok: false, status: 400 };
  }

  const user = await authStore.getUserBySessionToken(getSessionToken(request));
  if (!user) {
    return { message: "请先登录", ok: false, status: 401 };
  }

  const [, workspaceId, documentId] = roomMatch;
  let access: DocumentAccess;
  try {
    access = await documentAuthorization.requireWorkspaceDocumentAction(
      user.id,
      workspaceId,
      documentId,
      "write",
    );
  } catch {
    return { message: "没有访问此协作文档的权限", ok: false, status: 403 };
  }
  if (access.workspaceId !== workspaceId) {
    return { message: "没有访问此协作文档的权限", ok: false, status: 403 };
  }
  if (!access.canWrite) {
    return { message: "只读成员不能加入可写协作通道", ok: false, status: 403 };
  }

  return { access, documentId, ok: true, roomName, userId: user.id };
}

export function isAllowedCollaborationOrigin(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) {
    return false;
  }

  try {
    const normalizedOrigin = new URL(origin).origin;
    return allowedOrigins.some((allowedOrigin) => {
      try {
        return new URL(allowedOrigin).origin === normalizedOrigin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}
