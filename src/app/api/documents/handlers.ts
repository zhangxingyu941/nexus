import { NextResponse } from "next/server";
import { DocumentNotFoundError } from "../../../server/documentAuthorization";
import { getSessionToken } from "../../../server/sessionCookie";

interface DocumentAuthStore {
  getUserBySessionToken(token: string): Promise<{ id: string } | null>;
}

interface DocumentStore {
  loadDocument(userId: string, publicId: string): Promise<unknown>;
}

interface DocumentRouteDependencies {
  authStore: DocumentAuthStore;
  documentStore: DocumentStore;
}

export function createDocumentRouteHandlers({
  authStore,
  documentStore,
}: DocumentRouteDependencies) {
  return {
    async GET(request: Request, publicId: string) {
      const user = await authStore.getUserBySessionToken(getSessionToken(request));
      if (!user) {
        return NextResponse.json({ error: "请先进入工作区" }, { status: 401 });
      }

      try {
        return NextResponse.json(await documentStore.loadDocument(user.id, publicId));
      } catch (error) {
        if (error instanceof DocumentNotFoundError) {
          return NextResponse.json({ error: "文档不存在或无权访问" }, { status: 404 });
        }
        throw error;
      }
    },
  };
}

export function documentServiceUnavailableResponse() {
  return NextResponse.json({ error: "当前未启用 PostgreSQL 模式" }, { status: 503 });
}
