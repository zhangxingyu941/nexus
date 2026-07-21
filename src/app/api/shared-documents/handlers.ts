import { NextResponse } from "next/server";
import {
  DocumentShareGoneError,
  DocumentShareNotFoundError,
  type PostgresDocumentShareStore,
} from "../../../server/postgresDocumentShareStore";

const SHARED_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

interface SharedDocumentDependencies {
  documentShareStore: Pick<PostgresDocumentShareStore, "loadSharedDocument">;
}

export function createSharedDocumentHandlers({
  documentShareStore,
}: SharedDocumentDependencies) {
  return {
    async GET(token: string) {
      try {
        return NextResponse.json(
          await documentShareStore.loadSharedDocument(token),
          { headers: SHARED_RESPONSE_HEADERS },
        );
      } catch (error) {
        if (error instanceof DocumentShareNotFoundError) {
          return sharedJson({ error: "分享链接不存在" }, 404);
        }
        if (error instanceof DocumentShareGoneError) {
          return sharedJson({ error: "分享链接已失效" }, 410);
        }
        throw error;
      }
    },
  };
}

export function sharedServiceUnavailableResponse() {
  return sharedJson({ error: "当前未启用 PostgreSQL 模式" }, 503);
}

function sharedJson(payload: unknown, status: number) {
  return NextResponse.json(payload, {
    headers: SHARED_RESPONSE_HEADERS,
    status,
  });
}
