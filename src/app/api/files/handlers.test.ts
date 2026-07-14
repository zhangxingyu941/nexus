// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { ObjectStorage, StoredObject } from "../../../server/objectStorage";
import { createFileRouteHandlers } from "./handlers";

class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, StoredObject>();

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

    const uploadResponse = await handlers.POST(
      new Request("http://localhost/api/files", { body: formData, method: "POST" }),
    );
    const uploadPayload = await uploadResponse.json() as {
      attachment: { key: string; kind: string; name: string; url: string };
    };

    expect(uploadResponse.status).toBe(201);
    expect(uploadPayload.attachment).toMatchObject({
      key: "local/object-1.png",
      kind: "image",
      name: "设计稿.png",
      url: "/api/files/local/object-1.png",
    });

    const downloadResponse = await handlers.GET(
      new Request("http://localhost/api/files/local/object-1.png"),
      uploadPayload.attachment.key,
    );

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("Content-Type")).toBe("image/png");
    await expect(downloadResponse.text()).resolves.toBe("image-body");
  });

  it("requires a database session and rejects viewer uploads", async () => {
    const objectStorage = new MemoryObjectStorage();
    const authStore = { getUserBySessionToken: vi.fn().mockResolvedValue(null) };
    const workspaceStore = { getWorkspaceAccess: vi.fn() };
    const handlers = createFileRouteHandlers({ authStore, objectStorage, workspaceStore });

    const unauthorizedResponse = await handlers.POST(
      new Request("http://localhost/api/files", { body: new FormData(), method: "POST" }),
    );
    expect(unauthorizedResponse.status).toBe(401);

    authStore.getUserBySessionToken.mockResolvedValue({ id: "viewer-1" });
    workspaceStore.getWorkspaceAccess.mockResolvedValue({ role: "viewer", workspaceId: "workspace-1" });
    const viewerResponse = await handlers.POST(
      new Request("http://localhost/api/files", { body: new FormData(), method: "POST" }),
    );

    expect(viewerResponse.status).toBe(403);
  });
});
