// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createMarkdownArchive, decodeMarkdownUpload } from "../shared/markdownArchive";
import type { EditorDocument } from "../features/editor/model/block";
import { MarkdownDocumentTransferService } from "./markdownDocumentTransferService";

const encoder = new TextEncoder();

describe("MarkdownDocumentTransferService", () => {
  it("reparses upload bytes and leaves no document after an attachment copy failure", async () => {
    const source = await createMarkdownArchive("# Imported\n\n![Diagram](assets/diagram.png)\n", [{
      bytes: encoder.encode("image"),
      mimeType: "image/png",
      path: "assets/diagram.png",
    }]);
    const createDocument = vi.fn();
    const deleteObject = vi.fn().mockResolvedValue(undefined);
    const service = new MarkdownDocumentTransferService({
      attachmentStore: { createAttachment: vi.fn() },
      documentStore: { createDocument, deleteDocument: vi.fn(), loadDocument: vi.fn() },
      idFactory: (() => {
        let index = 0;
        return () => `id-${index++}`;
      })(),
      now: () => 10,
      objectStorage: {
        deleteObject,
        getObject: vi.fn(),
        putObject: vi.fn().mockRejectedValue(new Error("storage unavailable")),
      },
    });

    await expect(service.importDocument({
      filename: "import.zip",
      source,
      userId: "editor-1",
      workspaceId: "workspace-1",
    })).rejects.toMatchObject({ code: "markdown_attachment_copy_failed" });
    expect(createDocument).not.toHaveBeenCalled();
    expect(deleteObject).toHaveBeenCalledWith("workspace-1/id-1.png");
  });

  it("creates an attachment-backed document and exports only its server snapshot", async () => {
    const source = await createMarkdownArchive("# Imported\n\n![Diagram](assets/diagram.png)\n", [{
      bytes: encoder.encode("image"),
      mimeType: "image/png",
      path: "assets/diagram.png",
    }]);
    const importedDocument = documentWithAttachment();
    const createDocument = vi.fn().mockResolvedValue({
      access: { publicId: "public-import", workspaceId: "workspace-1" },
      document: importedDocument,
    });
    const objectStorage = {
      deleteObject: vi.fn().mockResolvedValue(undefined),
      getObject: vi.fn().mockResolvedValue({
        body: encoder.encode("image"),
        contentType: "image/png",
        size: 5,
      }),
      putObject: vi.fn().mockResolvedValue(undefined),
    };
    const service = new MarkdownDocumentTransferService({
      attachmentStore: {
        createAttachment: vi.fn().mockResolvedValue(undefined),
        findDocumentAttachment: vi.fn().mockResolvedValue({
          documentId: "document-1",
          key: "workspace-1/diagram.png",
          workspaceId: "workspace-1",
        }),
      },
      documentStore: {
        createDocument,
        deleteDocument: vi.fn(),
        loadDocument: vi.fn().mockResolvedValue({
          access: { publicId: "public-import", workspaceId: "workspace-1" },
          document: importedDocument,
        }),
      },
      idFactory: () => "diagram",
      now: () => 10,
      objectStorage,
    });

    const imported = await service.importDocument({
      filename: "import.zip",
      source,
      userId: "editor-1",
      workspaceId: "workspace-1",
    });
    const exported = await service.exportDocument({
      documentPublicId: "public-import",
      userId: "reader-1",
      workspaceId: "workspace-1",
    });

    expect(imported.publicId).toBe("public-import");
    expect(createDocument).toHaveBeenCalledWith(
      "editor-1",
      "workspace-1",
      expect.objectContaining({ title: "Imported" }),
      0,
    );
    expect(exported.contentType).toBe("application/zip");
    const decoded = await decodeMarkdownUpload("export.zip", exported.body);
    expect(decoded).toMatchObject({ markdown: "# Imported\n\n![diagram.png](assets/diagram.png-6037f739)\n", ok: true });
    expect(objectStorage.getObject).toHaveBeenCalledWith("workspace-1/diagram.png");
  });
});

function documentWithAttachment(): EditorDocument {
  return {
    blocks: [{
      assignee: "",
      checked: false,
      children: [],
      comments: [],
      content: "",
      createdAt: 10,
      data: {
        key: "workspace-1/diagram.png",
        kind: "image",
        mimeType: "image/png",
        name: "diagram.png",
        size: 5,
        url: "/api/files/workspace-1/diagram.png",
      },
      dueDate: "",
      headingLevel: 1,
      id: "image-1",
      parentId: null,
      richText: null,
      status: "unset",
      type: "image",
      updatedAt: 10,
    }],
    id: "document-1",
    title: "Imported",
    updatedAt: 10,
  };
}
