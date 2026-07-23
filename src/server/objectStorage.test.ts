import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createObjectKey, LocalObjectStorage, S3ObjectStorage } from "./objectStorage";

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

  it("deletes one workspace prefix without touching another", async () => {
    const storage = new LocalObjectStorage(storageDir);
    const bytes = new TextEncoder().encode("image-bytes");

    await storage.putObject("workspace-1/a.png", bytes, "image/png");
    await storage.putObject("workspace-2/b.png", bytes, "image/png");

    await storage.deletePrefix("workspace-1/");

    await expect(storage.getObject("workspace-1/a.png")).rejects.toThrow();
    await expect(storage.getObject("workspace-2/b.png")).resolves.toMatchObject({
      size: bytes.byteLength,
    });
    await expect(storage.deletePrefix("workspace-1/")).resolves.toBeUndefined();
  });

  it("deletes one object and its metadata without touching another object", async () => {
    const storage = new LocalObjectStorage(storageDir);
    const bytes = new TextEncoder().encode("image-bytes");

    await storage.putObject("workspace-1/a.png", bytes, "image/png");
    await storage.putObject("workspace-1/b.png", bytes, "image/png");

    await storage.deleteObject("workspace-1/a.png");

    await expect(storage.getObject("workspace-1/a.png")).rejects.toThrow();
    await expect(storage.getObject("workspace-1/b.png")).resolves.toMatchObject({
      size: bytes.byteLength,
    });
  });

  it("rejects a prefix that does not name exactly one workspace directory", async () => {
    const storage = new LocalObjectStorage(storageDir);

    await expect(storage.deletePrefix("workspace-1/a.png")).rejects.toThrow("对象前缀不正确");
  });
});

describe("S3ObjectStorage", () => {
  it("deletes exactly one validated object key", async () => {
    const storage = new S3ObjectStorage({ bucket: "uploads", region: "us-east-1" });
    const commands: DeleteObjectCommand[] = [];
    const client = storage as unknown as {
      client: { send: (command: DeleteObjectCommand) => Promise<unknown> };
    };
    client.client.send = async (command) => {
      commands.push(command);
      return {};
    };

    await storage.deleteObject("workspace-1/a.png");

    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(commands[0].input).toEqual({ Bucket: "uploads", Key: "workspace-1/a.png" });
  });

  it("paginates and deletes objects in batches of at most 1000", async () => {
    const storage = new S3ObjectStorage({ bucket: "uploads", region: "us-east-1" });
    const commands: Array<ListObjectsV2Command | DeleteObjectsCommand> = [];
    const client = storage as unknown as {
      client: { send: (command: ListObjectsV2Command | DeleteObjectsCommand) => Promise<unknown> };
    };
    const firstPage = Array.from({ length: 1_001 }, (_, index) => ({
      Key: `workspace-1/${index}.png`,
    }));

    client.client.send = async (command) => {
      commands.push(command);

      if (command instanceof ListObjectsV2Command) {
        return command.input.ContinuationToken
          ? { Contents: [{ Key: "workspace-1/final.png" }], IsTruncated: false }
          : { Contents: firstPage, IsTruncated: true, NextContinuationToken: "page-2" };
      }

      return {};
    };

    await storage.deletePrefix("workspace-1/");

    const listCommands = commands.filter(
      (command): command is ListObjectsV2Command => command instanceof ListObjectsV2Command,
    );
    const deleteCommands = commands.filter(
      (command): command is DeleteObjectsCommand => command instanceof DeleteObjectsCommand,
    );

    expect(listCommands.map((command) => command.input)).toEqual([
      { Bucket: "uploads", Prefix: "workspace-1/" },
      { Bucket: "uploads", ContinuationToken: "page-2", Prefix: "workspace-1/" },
    ]);
    expect(deleteCommands).toHaveLength(3);
    expect(deleteCommands.every((command) => (
      (command.input.Delete?.Objects?.length ?? 0) <= 1_000
    ))).toBe(true);
    expect(deleteCommands.flatMap((command) => command.input.Delete?.Objects ?? [])).toHaveLength(1_002);
  });

  it("throws when S3 reports a partial deletion failure", async () => {
    const storage = new S3ObjectStorage({ bucket: "uploads", region: "us-east-1" });
    const client = storage as unknown as {
      client: { send: (command: ListObjectsV2Command | DeleteObjectsCommand) => Promise<unknown> };
    };

    client.client.send = async (command) => {
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [{ Key: "workspace-1/a.png" }], IsTruncated: false };
      }

      return { Errors: [{ Code: "AccessDenied", Key: "workspace-1/a.png" }] };
    };

    await expect(storage.deletePrefix("workspace-1/")).rejects.toThrow();
  });

  it("does not send a delete request when an S3 prefix is empty", async () => {
    const storage = new S3ObjectStorage({ bucket: "uploads", region: "us-east-1" });
    const commands: Array<ListObjectsV2Command | DeleteObjectsCommand> = [];
    const client = storage as unknown as {
      client: { send: (command: ListObjectsV2Command | DeleteObjectsCommand) => Promise<unknown> };
    };

    client.client.send = async (command) => {
      commands.push(command);
      return { Contents: [], IsTruncated: false };
    };

    await expect(storage.deletePrefix("workspace-1/")).resolves.toBeUndefined();

    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(ListObjectsV2Command);
  });
});
