import type { EditorDocument } from "../model/block";
import {
  decodeMarkdownUpload,
  type MarkdownArchiveDecodeResult,
} from "../../../shared/markdownArchive";
import {
  parseMarkdownDocument,
  serializeDocumentToMarkdown,
  type MarkdownDiagnostic,
  type MarkdownImportAsset,
} from "../../../shared/markdownDocument";

export type MarkdownTransferTarget = "local" | "remote";

export interface MarkdownTransferPreview {
  diagnostics: MarkdownDiagnostic[];
  document: EditorDocument | null;
}

export interface MarkdownImportResult {
  diagnostics: MarkdownDiagnostic[];
  document: EditorDocument;
  publicId?: string;
}

export interface MarkdownExportResult {
  blob: Blob;
  filename: string;
}

export class MarkdownTransferClientError extends Error {
  constructor(
    readonly diagnostics: MarkdownDiagnostic[] = [],
    message = "Markdown transfer failed",
  ) {
    super(message);
    this.name = "MarkdownTransferClientError";
  }
}

interface MarkdownTransferRepositoryOptions {
  now?: () => number;
}

export function createMarkdownTransferRepository(
  target: MarkdownTransferTarget,
  options: MarkdownTransferRepositoryOptions = {},
) {
  const now = options.now ?? Date.now;

  async function preview(file: File): Promise<MarkdownTransferPreview> {
    if (target === "local" && !file.name.toLowerCase().endsWith(".md")) {
      throw new MarkdownTransferClientError([], "Local import supports .md files only");
    }
    const decoded = await decodeFile(file);
    if (!decoded.ok) throw new MarkdownTransferClientError([], decoded.message);
    const assets = previewAssets(decoded);
    const parsed = parseMarkdownDocument(decoded.markdown, {
      assets,
      documentId: `markdown-preview-${now()}`,
      filename: file.name,
      now: now(),
    });
    return { diagnostics: parsed.diagnostics, document: parsed.document };
  }

  async function importDocument(workspaceId: string, file: File): Promise<MarkdownImportResult> {
    if (target === "local") {
      const result = await preview(file);
      if (!result.document || result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
        throw new MarkdownTransferClientError(result.diagnostics, "Markdown document is invalid");
      }
      return { diagnostics: result.diagnostics, document: result.document };
    }

    const form = new FormData();
    form.set("file", file);
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/markdown-import`, {
      body: form,
      headers: { Accept: "application/json" },
      method: "POST",
    });
    const payload = await response.json().catch(() => null) as {
      diagnostics?: MarkdownDiagnostic[];
      document?: EditorDocument;
      error?: string;
      publicId?: string;
    } | null;
    if (!response.ok || !payload?.document || !payload.publicId) {
      throw new MarkdownTransferClientError(payload?.diagnostics ?? [], payload?.error || "Markdown import failed");
    }
    return {
      diagnostics: payload.diagnostics ?? [],
      document: payload.document,
      publicId: payload.publicId,
    };
  }

  async function exportDocument(
    workspaceId: string,
    documentPublicId: string | undefined,
    document: EditorDocument,
  ): Promise<MarkdownExportResult> {
    if (target === "local") {
      const result = serializeDocumentToMarkdown(document);
      if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error") || result.resources.length > 0) {
        throw new MarkdownTransferClientError(result.diagnostics, "Local export does not support attachments");
      }
      return {
        blob: new Blob([result.markdown], { type: "text/markdown;charset=utf-8" }),
        filename: `${document.title.trim() || "document"}.md`,
      };
    }
    if (!documentPublicId) {
      throw new MarkdownTransferClientError([], "Document export is unavailable");
    }

    const response = await fetch(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/documents/${encodeURIComponent(documentPublicId)}/markdown-export`,
      { headers: { Accept: "text/markdown, application/zip" }, method: "GET" },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new MarkdownTransferClientError([], payload?.error || "Markdown export failed");
    }
    return {
      blob: await response.blob(),
      filename: filenameFromDisposition(response.headers.get("content-disposition"))
        || `${document.title.trim() || "document"}.md`,
    };
  }

  return { exportDocument, importDocument, preview, target };
}

async function decodeFile(file: File) {
  return decodeMarkdownUpload(file.name, new Uint8Array(await file.arrayBuffer()));
}

function previewAssets(decoded: Extract<MarkdownArchiveDecodeResult, { ok: true }>) {
  return new Map(decoded.resources.map((resource, index): [string, MarkdownImportAsset] => [
    resource.path,
    {
      key: `preview-${index}`,
      mimeType: resource.mimeType,
      name: resource.path.split("/").at(-1) || "attachment",
      path: resource.path,
      size: resource.bytes.byteLength,
    },
  ]));
}

function filenameFromDisposition(value: string | null) {
  const encoded = value?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return "";
    }
  }
  return value?.match(/filename="?([^";]+)"?/i)?.[1] ?? "";
}
