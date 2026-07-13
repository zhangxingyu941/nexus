import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createObjectKey, LocalObjectStorage } from "./objectStorage";

describe("LocalObjectStorage", () => {
  let storageDir = "";

  beforeEach(async () => {
    storageDir = await mkdtemp(join(tmpdir(), "notion-object-storage-"));
  });

  afterEach(async () => {
    await rm(storageDir, { force: true, recursive: true });
  });

  it("stores and reads object bytes with exact metadata", async () => {
    const storage = new LocalObjectStorage(storageDir);
    const body = new TextEncoder().encode("image-bytes");

    await storage.putObject("workspace-1/object-1.png", body, "image/png");

    const stored = await storage.getObject("workspace-1/object-1.png");

    expect(stored).toMatchObject({
      contentType: "image/png",
      size: body.byteLength,
    });
    expect(Array.from(stored.body)).toEqual(Array.from(body));
  });

  it("creates workspace-scoped keys and rejects traversal", async () => {
    expect(createObjectKey("workspace-1", "设计稿.PNG", () => "object-1")).toBe(
      "workspace-1/object-1.png",
    );
    const storage = new LocalObjectStorage(storageDir);

    await expect(storage.getObject("../secret.txt")).rejects.toThrow("对象标识不正确");
  });
});
