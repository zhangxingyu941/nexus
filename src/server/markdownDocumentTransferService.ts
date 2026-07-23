import type { AttachmentBlockData, EditorDocument } from "../features/editor/model/block";
import {
  createMarkdownArchive,
  decodeMarkdownUpload,
  type MarkdownArchiveResource,
} from "../shared/markdownArchive";
import {
  parseMarkdownDocument,
  serializeDocumentToMarkdown,
  type MarkdownDiagnostic,
  type MarkdownImportAsset,
} from "../shared/markdownDocument";
import { createObjectKey, type ObjectStorage } from "./objectStorage";

interface MarkdownTransferAuth {
  publicId: string;
  workspaceId: string;
}

interface CreatedMarkdownDocument {
  access: MarkdownTransferAuth;
  document: EditorDocument;
}

interface MarkdownDocumentStore {
  createDocument(
    userId: string,
    workspaceId: string,
    document: EditorDocument,
    position: number,
  ): Promise<CreatedMarkdownDocument>;
  deleteDocument(userId: string, workspaceId: string, publicId: string): Promise<unknown>;
  loadDocument(userId: string, publicId: string): Promise<{ access: MarkdownTransferAuth; document: EditorDocument }>;
}

interface MarkdownAttachmentStore {
  createAttachment(attachment: { documentId: string; key: string; workspaceId: string }): Promise<unknown>;
  findDocumentAttachment?: (
    key: string,
    workspaceId: string,
    documentId: string,
  ) => Promise<{ documentId: string; key: string; workspaceId: string } | null>;
}

export interface MarkdownImportRequest {
  filename: string;
  position?: number;
  source: Uint8Array;
  userId: string;
  workspaceId: string;
}

export interface MarkdownExportRequest {
  documentPublicId: string;
  userId: string;
  workspaceId: string;
}

export interface MarkdownImportResponse {
  diagnostics: MarkdownDiagnostic[];
  document: EditorDocument;
  publicId: string;
}

export interface MarkdownExportResponse {
  body: Uint8Array;
  contentType: "application/zip" | "text/markdown; charset=utf-8";
  filename: string;
}

export class MarkdownTransferError extends Error {
  constructor(
    readonly code: string,
    readonly diagnostics: MarkdownDiagnostic[] = [],
    message = code,
  ) {
    super(message);
    this.name = "MarkdownTransferError";
  }
}

interface MarkdownDocumentTransferServiceOptions {
  attachmentStore: MarkdownAttachmentStore;
  documentStore: MarkdownDocumentStore;
  idFactory?: () => string;
  now?: () => number;
  objectStorage: Pick<ObjectStorage, "deleteObject" | "getObject" | "putObject">;
}

interface ImportedAsset {
  archive: MarkdownArchiveResource;
  asset: MarkdownImportAsset;
}

export class MarkdownDocumentTransferService {
  private readonly attachmentStore: MarkdownAttachmentStore;
  private readonly documentStore: MarkdownDocumentStore;
  private readonly idFactory: () => string;
  private readonly now: () => number;
  private readonly objectStorage: MarkdownDocumentTransferServiceOptions["objectStorage"];

  constructor(options: MarkdownDocumentTransferServiceOptions) {
    this.attachmentStore = options.attachmentStore;
    this.documentStore = options.documentStore;
    this.idFactory = options.idFactory ?? crypto.randomUUID;
    this.now = options.now ?? Date.now;
    this.objectStorage = options.objectStorage;
  }

  async importDocument(request: MarkdownImportRequest): Promise<MarkdownImportResponse> {
    const decoded = await decodeMarkdownUpload(request.filename, request.source);
    if (!decoded.ok) {
      throw new MarkdownTransferError(decoded.code, [], decoded.message);
    }

    const now = this.now();
    const documentId = `markdown-${this.idFactory()}`;
    const assets = decoded.resources.map((archive) => this.createImportedAsset(request.workspaceId, archive));
    const parsed = parseMarkdownDocument(decoded.markdown, {
      assets: new Map(assets.map((item) => [item.asset.path, item.asset])),
      documentId,
      filename: request.filename,
      nextId: () => `block-${this.idFactory()}`,
      now,
    });
    if (!parsed.document) {
      throw new MarkdownTransferError("markdown_parse_invalid", parsed.diagnostics, "Markdown document is invalid");
    }

    const writtenKeys: string[] = [];
    let created: CreatedMarkdownDocument | null = null;
    try {
      for (const item of assets) {
        writtenKeys.push(item.asset.key);
        await this.objectStorage.putObject(
          item.asset.key,
          item.archive.bytes,
          item.asset.mimeType,
        );
      }

      created = await this.documentStore.createDocument(
        request.userId,
        request.workspaceId,
        parsed.document,
        request.position ?? 0,
      );
      if (created.access.workspaceId !== request.workspaceId) {
        throw new MarkdownTransferError("markdown_import_forbidden");
      }
      for (const item of assets) {
        await this.attachmentStore.createAttachment({
          documentId: created.document.id,
          key: item.asset.key,
          workspaceId: request.workspaceId,
        });
      }

      return {
        diagnostics: parsed.diagnostics,
        document: created.document,
        publicId: created.access.publicId,
      };
    } catch (error) {
      const cleanupErrors = await this.cleanupImport(request, created, writtenKeys);
      if (cleanupErrors.length > 0) {
        throw new MarkdownTransferError("markdown_import_cleanup_failed", [], "Markdown import cleanup failed");
      }
      if (error instanceof MarkdownTransferError) throw error;
      throw new MarkdownTransferError(
        created ? "markdown_import_failed" : "markdown_attachment_copy_failed",
        [],
        "Markdown import failed",
      );
    }
  }

  async exportDocument(request: MarkdownExportRequest): Promise<MarkdownExportResponse> {
    const snapshot = await this.documentStore.loadDocument(request.userId, request.documentPublicId);
    if (snapshot.access.workspaceId !== request.workspaceId) {
      throw new MarkdownTransferError("markdown_export_forbidden");
    }

    const serialized = serializeDocumentToMarkdown(snapshot.document);
    if (serialized.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      throw new MarkdownTransferError("markdown_export_invalid", serialized.diagnostics, "Document cannot be exported");
    }

    const filename = `${sanitizeFilename(snapshot.document.title)}.md`;
    if (serialized.resources.length === 0) {
      return {
        body: new TextEncoder().encode(serialized.markdown),
        contentType: "text/markdown; charset=utf-8",
        filename,
      };
    }

    const attachmentBlocks = snapshot.document.blocks.flatMap((block) => (
      block.data?.kind === "image" || block.data?.kind === "file" ? [block.data] : []
    ));
    if (attachmentBlocks.length !== serialized.resources.length) {
      throw new MarkdownTransferError("markdown_export_invalid", serialized.diagnostics, "Attachment export mapping is invalid");
    }

    const resources = await Promise.all(serialized.resources.map(async (resource, index) => {
      const attachment = attachmentBlocks[index]!;
      await this.requireStoredAttachment(attachment, request.workspaceId, snapshot.document.id);
      let object;
      try {
        object = await this.objectStorage.getObject(attachment.key);
      } catch {
        throw new MarkdownTransferError("markdown_attachment_missing", [], "Attachment object is unavailable");
      }
      if (object.size !== attachment.size) {
        throw new MarkdownTransferError("markdown_attachment_missing", [], "Attachment object size is invalid");
      }
      return { bytes: object.body, mimeType: object.contentType, path: resource.path };
    }));
    const body = await createMarkdownArchive(serialized.markdown, resources);
    return { body, contentType: "application/zip", filename: filename.replace(/\.md$/, ".zip") };
  }

  private createImportedAsset(workspaceId: string, archive: MarkdownArchiveResource): ImportedAsset {
    const name = archive.path.split("/").at(-1) || "attachment";
    const mimeType = inferMimeType(name, archive.mimeType);
    return {
      archive,
      asset: {
        key: createObjectKey(workspaceId, name, this.idFactory),
        mimeType,
        name,
        path: archive.path,
        size: archive.bytes.byteLength,
      },
    };
  }

  private async cleanupImport(
    request: MarkdownImportRequest,
    created: CreatedMarkdownDocument | null,
    keys: string[],
  ) {
    const cleanupErrors: unknown[] = [];
    if (created) {
      try {
        await this.documentStore.deleteDocument(request.userId, request.workspaceId, created.access.publicId);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    for (const key of keys) {
      try {
        await this.objectStorage.deleteObject(key);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    return cleanupErrors;
  }

  private async requireStoredAttachment(
    attachment: AttachmentBlockData,
    workspaceId: string,
    documentId: string,
  ) {
    if (!this.attachmentStore.findDocumentAttachment) return;
    const stored = await this.attachmentStore.findDocumentAttachment(attachment.key, workspaceId, documentId);
    if (!stored || stored.key !== attachment.key || stored.workspaceId !== workspaceId || stored.documentId !== documentId) {
      throw new MarkdownTransferError("markdown_attachment_missing", [], "Attachment record is unavailable");
    }
  }
}

function inferMimeType(name: string, fallback: string) {
  const extension = name.split(".").at(-1)?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "svg") return "image/svg+xml";
  if (extension === "pdf") return "application/pdf";
  if (extension === "txt") return "text/plain";
  return fallback;
}

function sanitizeFilename(title: string) {
  const value = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return value || "document";
}
