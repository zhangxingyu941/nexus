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

  it("authorizes the workspace submitted by the client instead of the selected workspace", async () => {
    const objectStorage = new MemoryObjectStorage();
    const authStore = { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "editor-1" }) };
    const workspaceStore = {
      getWorkspaceAccess: vi.fn().mockResolvedValue({ role: "editor", workspaceId: "workspace-a" }),
    };
    const handlers = createFileRouteHandlers({
      authStore,
      idFactory: () => "object-1",
      objectStorage,
      workspaceStore,
    });
    const formData = new FormData();
    formData.set("kind", "file");
    formData.set("file", new File(["body"], "方案.pdf", { type: "application/pdf" }));
    formData.set("workspaceId", "workspace-a");

    const uploadResponse = await handlers.POST(
      new Request("http://localhost/api/files", { body: formData, method: "POST" }),
    );
    expect(uploadResponse.status).toBe(201);
    expect(workspaceStore.getWorkspaceAccess).toHaveBeenCalledWith("editor-1", "workspace-a");
    expect([...objectStorage.objects.keys()]).toEqual(["workspace-a/object-1.pdf"]);

    const downloadResponse = await handlers.GET(
      new Request("http://localhost/api/files/workspace-a/object-1.pdf"),
      "workspace-a/object-1.pdf",
    );
    expect(downloadResponse.status).toBe(200);
    expect(workspaceStore.getWorkspaceAccess).toHaveBeenLastCalledWith("editor-1", "workspace-a");
  });

  it("rejects invalid local workspace ids and inaccessible database workspaces", async () => {
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
      authStore: { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "editor-1" }) },
      objectStorage,
      workspaceStore: { getWorkspaceAccess: vi.fn().mockResolvedValue(null) },
    });
    const deniedForm = new FormData();
    deniedForm.set("kind", "file");
    deniedForm.set("file", new File(["body"], "方案.pdf", { type: "application/pdf" }));
    deniedForm.set("workspaceId", "workspace-a");
    const deniedResponse = await deniedHandlers.POST(
      new Request("http://localhost/api/files", { body: deniedForm, method: "POST" }),
    );

    expect(deniedResponse.status).toBe(403);
  });
});
