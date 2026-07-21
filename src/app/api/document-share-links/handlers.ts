import { NextResponse } from "next/server";
import { DocumentNotFoundError } from "../../../server/documentAuthorization";
import {
  DocumentShareNotFoundError,
  type PostgresDocumentShareStore,
} from "../../../server/postgresDocumentShareStore";
import { getSessionToken } from "../../../server/sessionCookie";

interface DocumentShareAuthStore {
  getUserBySessionToken(token: string): Promise<{ id: string } | null>;
}

interface DocumentShareLinkDependencies {
  authStore: DocumentShareAuthStore;
  documentShareStore: Pick<
    PostgresDocumentShareStore,
    "getManagedLink" | "replaceManagedLink" | "revokeManagedLink"
  >;
}

export function createDocumentShareLinkHandlers({
  authStore,
  documentShareStore,
}: DocumentShareLinkDependencies) {
  async function getUser(request: Request) {
    return authStore.getUserBySessionToken(getSessionToken(request));
  }

  return {
    async GET(request: Request, publicId: string) {
      const user = await getUser(request);
      if (!user) return unauthorizedResponse();

      try {
        return NextResponse.json({
          shareLink: await documentShareStore.getManagedLink(user.id, publicId),
        });
      } catch (error) {
        return mapDocumentShareError(error);
      }
    },

    async POST(request: Request, publicId: string) {
      const user = await getUser(request);
      if (!user) return unauthorizedResponse();

      const payload = await parseCreatePayload(request);
      if (payload instanceof NextResponse) return payload;

      try {
        const shareLink = await documentShareStore.replaceManagedLink(
          user.id,
          publicId,
          payload.expiresAt,
        );
        return NextResponse.json({ shareLink }, { status: 201 });
      } catch (error) {
        return mapDocumentShareError(error);
      }
    },

    async DELETE(request: Request, publicId: string) {
      const user = await getUser(request);
      if (!user) return unauthorizedResponse();

      try {
        await documentShareStore.revokeManagedLink(user.id, publicId);
        return new NextResponse(null, { status: 204 });
      } catch (error) {
        return mapDocumentShareError(error);
      }
    },
  };
}

export function documentShareServiceUnavailableResponse() {
  return NextResponse.json({ error: "当前未启用 PostgreSQL 模式" }, { status: 503 });
}

async function parseCreatePayload(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "请求 JSON 格式不正确" }, { status: 400 });
  }
  if (!isRecord(payload)) {
    return NextResponse.json({ error: "分享链接格式不正确" }, { status: 400 });
  }
  const keys = Object.keys(payload);
  if (
    keys.some((key) => key !== "expiresAt")
    || (payload.expiresAt !== undefined && typeof payload.expiresAt !== "number")
  ) {
    return NextResponse.json({ error: "分享链接格式不正确" }, { status: 400 });
  }

  return { expiresAt: payload.expiresAt as number | undefined };
}

function mapDocumentShareError(error: unknown) {
  if (
    error instanceof DocumentNotFoundError
    || error instanceof DocumentShareNotFoundError
  ) {
    return NextResponse.json({ error: "文档不存在或无权访问" }, { status: 404 });
  }
  if (error instanceof TypeError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  throw error;
}

function unauthorizedResponse() {
  return NextResponse.json({ error: "请先进入工作区" }, { status: 401 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
