import { NextResponse } from "next/server";
import { parseBlockClipboardPayload } from "@/features/editor/model/blockClipboard";
import { documentServiceUnavailableResponse } from "@/app/api/documents/handlers";
import { createPostgresServices } from "@/server/applicationServices";
import {
  BlockClipboardPasteCleanupError,
  BlockClipboardPasteValidationError,
  type BlockClipboardPasteService,
} from "@/server/blockClipboardPasteService";
import { hasDatabaseConfiguration } from "@/server/database/pool";
import { DocumentNotFoundError } from "@/server/documentAuthorization";
import { getSessionToken } from "@/server/sessionCookie";

const FORBIDDEN_ERROR = "没有粘贴所需的文档权限";
const SAME_WORKSPACE_ERROR = "只能粘贴同一工作区的块";

interface BlockClipboardPasteRouteContext {
  params: Promise<{ documentId: string; workspaceId: string }>;
}

interface BlockClipboardPasteRouteDependencies {
  authStore: {
    getUserBySessionToken(token: string): Promise<{ id: string } | null>;
  };
  pasteService: Pick<BlockClipboardPasteService, "paste">;
}

export function createBlockClipboardPasteRouteHandlers({
  authStore,
  pasteService,
}: BlockClipboardPasteRouteDependencies) {
  return {
    async POST(request: Request, workspaceId: string, targetDocumentId: string) {
      const user = await authStore.getUserBySessionToken(getSessionToken(request));
      if (!user) {
        return NextResponse.json({ error: "请先进入工作区" }, { status: 401 });
      }

      const body = await parseJson(request);
      if (body === null) {
        return NextResponse.json({ error: "请求 JSON 格式不正确" }, { status: 400 });
      }
      const value = body && typeof body === "object" && "payload" in body
        ? (body as { payload: unknown }).payload
        : null;
      const parsed = parseBlockClipboardPayload(value);
      if (!parsed.payload) {
        return NextResponse.json({ error: parsed.reason ?? "块剪贴板内容无效" }, { status: 400 });
      }
      if (parsed.payload.sourceWorkspaceId !== workspaceId) {
        return NextResponse.json({ error: SAME_WORKSPACE_ERROR }, { status: 400 });
      }

      try {
        const blocks = await pasteService.paste({
          payload: parsed.payload,
          targetDocumentId,
          userId: user.id,
          workspaceId,
        });
        return NextResponse.json({ blocks });
      } catch (error) {
        if (error instanceof DocumentNotFoundError) {
          return NextResponse.json({ error: FORBIDDEN_ERROR }, { status: 403 });
        }
        if (error instanceof BlockClipboardPasteValidationError) {
          return NextResponse.json({ error: error.message }, { status: 400 });
        }
        if (error instanceof BlockClipboardPasteCleanupError) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        throw error;
      }
    },
  };
}

export async function POST(request: Request, context: BlockClipboardPasteRouteContext) {
  if (!hasDatabaseConfiguration()) return documentServiceUnavailableResponse();
  const { documentId, workspaceId } = await context.params;
  const services = createPostgresServices();
  return createBlockClipboardPasteRouteHandlers({
    authStore: services.authStore,
    pasteService: services.blockClipboardPasteService,
  }).POST(request, workspaceId, documentId);
}

async function parseJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
