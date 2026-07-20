// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { ObjectStorage, StoredObject } from "../../../server/objectStorage";
import { createFileRouteHandlers } from "./handlers";

class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, StoredObject>();

  async deletePrefix(prefix: string) {
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) {
        this.objects.delete(key);
      }
    }
  }

  async putObject(key: string, body: Uint8Array, contentType: string) {
    this.objects.set(key, { body, contentType, size: body.byteLength });
  }

  async getObject(key: string) {
    const object = this.objects.get(key);

    if (!object) {
      throw new Error("对象不存在");
    }

    return object;
  }
}

describe("file route handlers", () => {
  it("uploads and reads a local image object", async () => {
    const objectStorage = new MemoryObjectStorage();
    const handlers = createFileRouteHandlers({
      idFactory: () => "object-1",
      objectStorage,
    });
    const formData = new FormData();
    formData.set("kind", "image");
    formData.set("file", new File(["image-body"], "设计稿.png", { type: "image/png" }));
    formData.set("workspaceId", "workspace-a");

    const uploadResponse = await handlers.POST(
      new Request("http://localhost/api/files", { body: formData, method: "POST" }),
    );
    const uploadPayload = await uploadResponse.json() as {
      attachment: { key: string; kind: string; name: string; url: string };
    };

    expect(uploadResponse.status).toBe(201);
    expect(uploadPayload.attachment).toMatchObject({
      key: "workspace-a/object-1.png",
      kind: "image",
      name: "设计稿.png",
      url: "/api/files/workspace-a/object-1.png",
    });

    const downloadResponse = await handlers.GET(
      new Request("http://localhost/api/files/workspace-a/object-1.png"),
      uploadPayload.attachment.key,
    );

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("Content-Type")).toBe("image/png");
    await expect(downloadResponse.text()).resolves.toBe("image-body");
  });

  it("maps an uploaded attachment to its authorized document", async () => {
    const objectStorage = new MemoryObjectStorage();
    const authStore = { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "editor-1" }) };
    const documentAuthorization = {
      requireWorkspaceDocumentAction: vi.fn().mockResolvedValue({
        canWrite: true,
        documentId: "document-1",
        workspaceId: "workspace-a",
      }),
    };
    const attachmentStore = {
      createAttachment: vi.fn(),
      findAttachment: vi.fn().mockResolvedValue({
        documentId: "document-1",
        key: "workspace-a/object-1.pdf",
        workspaceId: "workspace-a",
      }),
    };
    const handlers = createFileRouteHandlers({
      attachmentStore,
      authStore,
      documentAuthorization,
      idFactory: () => "object-1",
      objectStorage,
    });
    const formData = new FormData();
    formData.set("kind", "file");
    formData.set("file", new File(["body"], "方案.pdf", { type: "application/pdf" }));
    formData.set("documentId", "document-1");
    formData.set("workspaceId", "workspace-a");

    const uploadResponse = await handlers.POST(
      new Request("http://localhost/api/files", { body: formData, method: "POST" }),
    );
    expect(uploadResponse.status).toBe(201);
    expect(documentAuthorization.requireWorkspaceDocumentAction).toHaveBeenCalledWith(
      "editor-1",
      "workspace-a",
      "document-1",
      "write",
    );
    expect(attachmentStore.createAttachment).toHaveBeenCalledWith({
      documentId: "document-1",
      key: "workspace-a/object-1.pdf",
      workspaceId: "workspace-a",
    });
    expect([...objectStorage.objects.keys()]).toEqual(["workspace-a/object-1.pdf"]);

    const downloadResponse = await handlers.GET(
      new Request("http://localhost/api/files/workspace-a/object-1.pdf"),
      "workspace-a/object-1.pdf",
    );
    expect(downloadResponse.status).toBe(200);
    expect(documentAuthorization.requireWorkspaceDocumentAction).toHaveBeenLastCalledWith(
      "editor-1",
      "workspace-a",
      "document-1",
      "read",
    );
  });

  it("rejects invalid local workspace ids and hides an ungranted document attachment", async () => {
    const objectStorage = new MemoryObjectStorage();
    const invalidForm = new FormData();
    invalidForm.set("kind", "file");
    invalidForm.set("file", new File(["body"], "方案.pdf", { type: "application/pdf" }));
    invalidForm.set("workspaceId", "../outside");
    const localHandlers = createFileRouteHandlers({ objectStorage });
    const invalidResponse = await localHandlers.POST(
      new Request("http://localhost/api/files", { body: invalidForm, method: "POST" }),
    );
    expect(invalidResponse.status).toBe(400);

    const deniedHandlers = createFileRouteHandlers({
      attachmentStore: {
        createAttachment: vi.fn(),
        findAttachment: vi.fn().mockResolvedValue({
          documentId: "private-document-1",
          key: "workspace-a/object-1.pdf",
          workspaceId: "workspace-a",
        }),
      },
      authStore: { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "editor-1" }) },
      documentAuthorization: { requireWorkspaceDocumentAction: vi.fn().mockRejectedValue(new Error("denied")) },
      objectStorage,
    });
    const deniedForm = new FormData();
    deniedForm.set("kind", "file");
    deniedForm.set("file", new File(["body"], "方案.pdf", { type: "application/pdf" }));
    deniedForm.set("documentId", "private-document-1");
    deniedForm.set("workspaceId", "workspace-a");
    const deniedResponse = await deniedHandlers.POST(
      new Request("http://localhost/api/files", { body: deniedForm, method: "POST" }),
    );

    expect(deniedResponse.status).toBe(404);
  });
});
