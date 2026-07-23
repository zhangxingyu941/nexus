import { NextResponse } from "next/server";
import {
  MarkdownTransferError,
  type MarkdownDocumentTransferService,
} from "@/server/markdownDocumentTransferService";
import { getSessionToken } from "@/server/sessionCookie";

interface MarkdownImportRouteDependencies {
  authStore: {
    getUserBySessionToken(token: string): Promise<{ id: string } | null>;
  };
  transferService: Pick<MarkdownDocumentTransferService, "importDocument">;
}

export function createMarkdownImportRouteHandlers({
  authStore,
  transferService,
}: MarkdownImportRouteDependencies) {
  return {
    async POST(request: Request, workspaceId: string) {
      const user = await authStore.getUserBySessionToken(getSessionToken(request));
      if (!user) return NextResponse.json({ error: "Authentication is required" }, { status: 401 });

      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
      }
      const file = form.get("file");
      if (!isUploadFile(file)) {
        return NextResponse.json({ error: "A Markdown file is required" }, { status: 400 });
      }

      const source = new Uint8Array(await file.arrayBuffer());
      const expectedSha256 = form.get("sha256");
      if (typeof expectedSha256 === "string" && expectedSha256 && !await hashMatches(source, expectedSha256)) {
        return NextResponse.json({ error: "Source SHA-256 does not match" }, { status: 400 });
      }

      try {
        const result = await transferService.importDocument({
          filename: file.name,
          source,
          userId: user.id,
          workspaceId,
        });
        return NextResponse.json(result, { status: 201 });
      } catch (error) {
        if (error instanceof MarkdownTransferError) {
          if (isImportClientError(error.code)) {
            return NextResponse.json({ diagnostics: error.diagnostics }, { status: 400 });
          }
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        throw error;
      }
    },
  };
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value &&
    typeof value === "object" &&
    "arrayBuffer" in value &&
    typeof value.arrayBuffer === "function" &&
    "name" in value &&
    typeof value.name === "string",
  );
}

function isImportClientError(code: string) {
  return code !== "markdown_attachment_copy_failed"
    && code !== "markdown_import_cleanup_failed"
    && code !== "markdown_import_failed";
}

async function hashMatches(source: Uint8Array, expected: string) {
  if (!/^[a-f0-9]{64}$/i.test(expected)) return false;
  const digest = await crypto.subtle.digest("SHA-256", source as BufferSource);
  const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return actual === expected.toLowerCase();
}
