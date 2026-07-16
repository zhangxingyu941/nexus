import { NextResponse } from "next/server";
import type { PostgresAuthStore } from "@/server/postgresAuthStore";
import type { PostgresWorkspaceStore } from "@/server/postgresWorkspaceStore";
import {
  WorkspaceNotFoundError,
  WorkspacePermissionError,
} from "@/server/postgresWorkspaceStore";
import { getSessionToken } from "@/server/sessionCookie";

interface DocumentHistoryRouteDependencies {
  authStore: PostgresAuthStore;
  workspaceStore: PostgresWorkspaceStore;
}

export function createDocumentHistoryRouteHandlers({
  authStore,
  workspaceStore,
}: DocumentHistoryRouteDependencies) {
  async function authenticate(request: Request) {
    return authStore.getUserBySessionToken(getSessionToken(request));
  }

  return {
    async GET(request: Request, workspaceId: string, documentId: string) {
      const user = await authenticate(request);
      if (!user) return unauthorizedResponse();

      try {
        return NextResponse.json({
          versions: await workspaceStore.listDocumentVersions(user.id, workspaceId, documentId),
        });
      } catch (error) {
        return mapHistoryError(error);
      }
    },

    async POST(request: Request, workspaceId: string, documentId: string) {
      const user = await authenticate(request);
      if (!user) return unauthorizedResponse();

      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return NextResponse.json({ error: "请求 JSON 格式不正确" }, { status: 400 });
      }

      const versionId = payload && typeof payload === "object" && "versionId" in payload
        ? (payload as { versionId?: unknown }).versionId
        : null;
      if (typeof versionId !== "string" || !versionId.trim()) {
        return NextResponse.json({ error: "版本标识不正确" }, { status: 400 });
      }

      try {
        return NextResponse.json({
          document: await workspaceStore.restoreDocumentVersion(
            user.id,
            workspaceId,
            documentId,
            versionId,
          ),
          restored: true,
        });
      } catch (error) {
        return mapHistoryError(error);
      }
    },
  };
}

function unauthorizedResponse() {
  return NextResponse.json({ error: "请先进入工作区" }, { status: 401 });
}

function mapHistoryError(error: unknown) {
  if (error instanceof WorkspaceNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof WorkspacePermissionError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof Error && error.message === "文档版本不存在") {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  throw error;
}
