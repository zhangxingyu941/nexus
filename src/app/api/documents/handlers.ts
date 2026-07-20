import { NextResponse } from "next/server";
import type { EditorDocument } from "../../../features/editor/model/block";
import { DocumentNotFoundError } from "../../../server/documentAuthorization";
import { DocumentPolicyMemberError } from "../../../server/postgresDocumentStore";
import { getSessionToken } from "../../../server/sessionCookie";
import { isDocumentPayload } from "../../../server/workspacePayload";
import type { DocumentPolicy } from "../../../shared/documentAccess";
import { isDocumentPolicy } from "../../../shared/documentAccess";

interface DocumentAuthStore {
  getUserBySessionToken(token: string): Promise<{ id: string } | null>;
}

interface DocumentStore {
  loadDocument(userId: string, publicId: string): Promise<unknown>;
  loadDocumentPolicy(userId: string, publicId: string): Promise<unknown>;
  replaceDocumentPolicy(userId: string, publicId: string, policy: DocumentPolicy): Promise<unknown>;
  saveDocument(userId: string, publicId: string, document: EditorDocument): Promise<unknown>;
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
        return unauthorizedResponse();
      }

      try {
        return NextResponse.json(await documentStore.loadDocument(user.id, publicId));
      } catch (error) {
        return mapDocumentError(error);
      }
    },

    async PUT(request: Request, publicId: string) {
      const user = await authStore.getUserBySessionToken(getSessionToken(request));
      if (!user) {
        return unauthorizedResponse();
      }

      const payload = await parseJson(request);
      if (payload instanceof NextResponse) return payload;
      const document = payload && typeof payload === "object" && "document" in payload
        ? (payload as { document: unknown }).document
        : undefined;
      if (!isDocumentPayload(document)) {
        return NextResponse.json({ error: "文档数据格式不正确" }, { status: 400 });
      }

      try {
        return NextResponse.json(await documentStore.saveDocument(user.id, publicId, document));
      } catch (error) {
        return mapDocumentError(error);
      }
    },

    async GETPermissions(request: Request, publicId: string) {
      const user = await authStore.getUserBySessionToken(getSessionToken(request));
      if (!user) {
        return unauthorizedResponse();
      }

      try {
        return NextResponse.json(await documentStore.loadDocumentPolicy(user.id, publicId));
      } catch (error) {
        return mapDocumentError(error);
      }
    },

    async PATCHPermissions(request: Request, publicId: string) {
      const user = await authStore.getUserBySessionToken(getSessionToken(request));
      if (!user) {
        return unauthorizedResponse();
      }

      const policy = await parseJson(request);
      if (policy instanceof NextResponse) return policy;
      if (!isDocumentPolicy(policy)) {
        return NextResponse.json({ error: "文档权限格式不正确" }, { status: 400 });
      }

      try {
        return NextResponse.json(await documentStore.replaceDocumentPolicy(user.id, publicId, policy));
      } catch (error) {
        return mapDocumentError(error);
      }
    },
  };
}

export function documentServiceUnavailableResponse() {
  return NextResponse.json({ error: "当前未启用 PostgreSQL 模式" }, { status: 503 });
}

async function parseJson(request: Request): Promise<unknown | NextResponse> {
  try {
    return await request.json();
  } catch {
    return NextResponse.json({ error: "请求 JSON 格式不正确" }, { status: 400 });
  }
}

function mapDocumentError(error: unknown): NextResponse {
  if (error instanceof DocumentNotFoundError) {
    return NextResponse.json({ error: "文档不存在或无权访问" }, { status: 404 });
  }
  if (error instanceof DocumentPolicyMemberError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  throw error;
}

function unauthorizedResponse() {
  return NextResponse.json({ error: "请先进入工作区" }, { status: 401 });
}
