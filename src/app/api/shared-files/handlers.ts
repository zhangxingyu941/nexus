import { NextResponse } from "next/server";
import {
  DocumentShareGoneError,
  DocumentShareNotFoundError,
  type PostgresDocumentShareStore,
} from "../../../server/postgresDocumentShareStore";

const SHARED_FILE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

interface SharedFileDependencies {
  documentShareStore: Pick<PostgresDocumentShareStore, "loadSharedAttachment">;
}

interface SharedFileRouteParameters {
  keyToken: string;
  shareId: string;
}

export function createSharedFileHandlers({
  documentShareStore,
}: SharedFileDependencies) {
  return {
    async GET(request: Request, parameters: SharedFileRouteParameters) {
      const url = new URL(request.url);
      const expiresAt = Number(url.searchParams.get("expiresAt"));
      const signature = url.searchParams.get("signature") ?? "";
      if (
        !parameters.shareId
        || !/^[A-Za-z0-9_-]+$/.test(parameters.keyToken)
        || !Number.isSafeInteger(expiresAt)
        || expiresAt <= 0
        || !/^[a-f0-9]{64}$/.test(signature)
      ) {
        return sharedFileError(404);
      }

      try {
        const object = await documentShareStore.loadSharedAttachment({
          expiresAt,
          keyToken: parameters.keyToken,
          shareId: parameters.shareId,
          signature,
        });
        return new Response(Uint8Array.from(object.body).buffer, {
          headers: {
            ...SHARED_FILE_HEADERS,
            "Content-Length": String(object.size),
            "Content-Type": object.contentType,
          },
        });
      } catch (error) {
        if (error instanceof DocumentShareGoneError) {
          return sharedFileError(410);
        }
        if (error instanceof DocumentShareNotFoundError) {
          return sharedFileError(404);
        }
        throw error;
      }
    },
  };
}

export function sharedFileServiceUnavailableResponse() {
  return NextResponse.json(
    { error: "当前未启用 PostgreSQL 模式" },
    { headers: SHARED_FILE_HEADERS, status: 503 },
  );
}

function sharedFileError(status: 404 | 410) {
  return NextResponse.json(
    { error: status === 410 ? "分享链接已失效" : "文件不存在" },
    { headers: SHARED_FILE_HEADERS, status },
  );
}
