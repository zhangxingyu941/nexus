import { NextResponse } from "next/server";
import type { EditorDocument } from "@/features/editor/model/block";
import { DocumentNotFoundError } from "@/server/documentAuthorization";
import { getSessionToken } from "@/server/sessionCookie";
import { isDocumentPayload } from "@/server/workspacePayload";

interface DocumentAuthStore {
  getUserBySessionToken(token: string): Promise<{ id: string } | null>;
}

interface WorkspaceDocumentStore {
  createDocument(
    userId: string,
    workspaceId: string,
    document: EditorDocument,
    position: number,
  ): Promise<unknown>;
  deleteDocument(
    userId: string,
    workspaceId: string,
    publicId: string,
  ): Promise<unknown>;
}

interface WorkspaceDocumentRouteDependencies {
  authStore: DocumentAuthStore;
  documentStore: WorkspaceDocumentStore;
}

export function createWorkspaceDocumentRouteHandlers({
  authStore,
  documentStore,
}: WorkspaceDocumentRouteDependencies) {
  return {
    async POST(request: Request, workspaceId: string) {
      const user = await authStore.getUserBySessionToken(getSessionToken(request));
      if (!user) return unauthorizedResponse();

      const payload = await parseJson(request);
      if (payload instanceof NextResponse) return payload;
      const document = payload && typeof payload === "object" && "document" in payload
        ? (payload as { document: unknown }).document
        : undefined;
      const position = payload && typeof payload === "object" && "position" in payload
        ? (payload as { position: unknown }).position
        : undefined;
      if (!isDocumentPayload(document) || !isDocumentPosition(position)) {
        return NextResponse.json({ error: "文档数据格式不正确" }, { status: 400 });
      }

      try {
        return NextResponse.json(await documentStore.createDocument(
          user.id,
          workspaceId,
          document,
          position,
        ));
      } catch (error) {
        return mapDocumentError(error);
      }
    },

    async DELETE(request: Request, workspaceId: string, publicId: string) {
      const user = await authStore.getUserBySessionToken(getSessionToken(request));
      if (!user) return unauthorizedResponse();

      try {
        return NextResponse.json(await documentStore.deleteDocument(user.id, workspaceId, publicId));
      } catch (error) {
        return mapDocumentError(error);
      }
    },
  };
}

async function parseJson(request: Request): Promise<unknown | NextResponse> {
  try {
    return await request.json();
  } catch {
    return NextResponse.json({ error: "请求 JSON 格式不正确" }, { status: 400 });
  }
}

function isDocumentPosition(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function mapDocumentError(error: unknown): NextResponse {
  if (error instanceof DocumentNotFoundError) {
    return NextResponse.json({ error: "文档不存在或无权访问" }, { status: 404 });
  }
  throw error;
}

function unauthorizedResponse() {
  return NextResponse.json({ error: "请先进入工作区" }, { status: 401 });
}
