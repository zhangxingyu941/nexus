import { NextResponse } from "next/server";
import { DocumentNotFoundError } from "@/server/documentAuthorization";
import {
  MarkdownTransferError,
  type MarkdownDocumentTransferService,
} from "@/server/markdownDocumentTransferService";
import { getSessionToken } from "@/server/sessionCookie";

interface MarkdownExportRouteDependencies {
  authStore: {
    getUserBySessionToken(token: string): Promise<{ id: string } | null>;
  };
  transferService: Pick<MarkdownDocumentTransferService, "exportDocument">;
}

export function createMarkdownExportRouteHandlers({
  authStore,
  transferService,
}: MarkdownExportRouteDependencies) {
  return {
    async GET(request: Request, workspaceId: string, documentPublicId: string) {
      const user = await authStore.getUserBySessionToken(getSessionToken(request));
      if (!user) return NextResponse.json({ error: "Authentication is required" }, { status: 401 });

      try {
        const result = await transferService.exportDocument({
          documentPublicId,
          userId: user.id,
          workspaceId,
        });
        return new Response(new Uint8Array(result.body).buffer, {
          headers: {
            "Content-Disposition": contentDisposition(result.filename),
            "Content-Type": result.contentType,
          },
        });
      } catch (error) {
        if (error instanceof DocumentNotFoundError) {
          return NextResponse.json({ error: "Document was not found" }, { status: 404 });
        }
        if (error instanceof MarkdownTransferError) {
          const status = error.code === "markdown_export_forbidden" ? 403 : 500;
          return NextResponse.json({ error: error.message, ...(error.diagnostics.length ? { diagnostics: error.diagnostics } : {}) }, { status });
        }
        throw error;
      }
    },
  };
}

function contentDisposition(filename: string) {
  const fallback = filename.replace(/[^A-Za-z0-9._-]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
