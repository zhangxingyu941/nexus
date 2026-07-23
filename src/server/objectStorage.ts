import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface StoredObject {
  body: Uint8Array;
  contentType: string;
  size: number;
}

export interface ObjectStorage {
  deleteObject: (key: string) => Promise<void>;
  deletePrefix: (prefix: string) => Promise<void>;
  getObject: (key: string) => Promise<StoredObject>;
  putObject: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
}

function validateObjectKey(key: string) {
  const segments = key.split("/");

  if (
    !key ||
    key.startsWith("/") ||
    key.includes("\\") ||
    segments.some((segment) => !segment || segment === "." || segment === "..") ||
    !/^[a-zA-Z0-9/_-]+(?:\.[a-zA-Z0-9]+)?$/.test(key)
  ) {
    throw new Error("对象标识不正确");
  }
}

function validateWorkspacePrefix(prefix: string) {
  if (!/^[a-zA-Z0-9_-]+\/$/.test(prefix)) {
    throw new Error("对象前缀不正确");
  }
}

export function createObjectKey(
  workspaceId: string,
  filename: string,
  idFactory: () => string = () => randomUUID(),
) {
  const extension = extname(filename).slice(1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12);
  const key = `${workspaceId}/${idFactory()}${extension ? `.${extension}` : ""}`;

  validateObjectKey(key);
  return key;
}

export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root = process.env.OBJECT_STORAGE_LOCAL_DIR ?? "server/data/uploads") {
    this.root = resolve(root);
  }

  async putObject(key: string, body: Uint8Array, contentType: string) {
    const objectPath = this.resolveObjectPath(key);

    await mkdir(resolve(objectPath, ".."), { recursive: true });
    await writeFile(objectPath, body);
    await writeFile(
      `${objectPath}.metadata.json`,
      JSON.stringify({ contentType, size: body.byteLength }),
      "utf8",
    );
  }

  async getObject(key: string): Promise<StoredObject> {
    const objectPath = this.resolveObjectPath(key);
    const [body, metadataText] = await Promise.all([
      readFile(objectPath),
      readFile(`${objectPath}.metadata.json`, "utf8"),
    ]);
    const metadata = JSON.parse(metadataText) as { contentType: string; size: number };

    return {
      body: new Uint8Array(body),
      contentType: metadata.contentType,
      size: metadata.size,
    };
  }

  async deletePrefix(prefix: string) {
    const workspacePath = this.resolveWorkspacePath(prefix);

    await rm(workspacePath, { force: true, recursive: true });
  }

  async deleteObject(key: string) {
    const objectPath = this.resolveObjectPath(key);

    await Promise.all([
      rm(objectPath, { force: true }),
      rm(`${objectPath}.metadata.json`, { force: true }),
    ]);
  }

  private resolveObjectPath(key: string) {
    validateObjectKey(key);
    const objectPath = resolve(this.root, ...key.split("/"));
    const relativePath = relative(this.root, objectPath);

    if (relativePath.startsWith(`..${sep}`) || relativePath === "..") {
      throw new Error("对象标识不正确");
    }

    return objectPath;
  }

  private resolveWorkspacePath(prefix: string) {
    validateWorkspacePrefix(prefix);
    const workspacePath = resolve(this.root, prefix.slice(0, -1));
    const relativePath = relative(this.root, workspacePath);

    if (relativePath.startsWith(`..${sep}`) || relativePath === "..") {
      throw new Error("对象前缀不正确");
    }

    return workspacePath;
  }
}

interface S3ObjectStorageOptions {
  accessKeyId?: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  region: string;
  secretAccessKey?: string;
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(options: S3ObjectStorageOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
      region: options.region,
      ...(options.accessKeyId && options.secretAccessKey
        ? {
            credentials: {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async putObject(key: string, body: Uint8Array, contentType: string) {
    validateObjectKey(key);
    await this.client.send(new PutObjectCommand({
      Body: body,
      Bucket: this.bucket,
      ContentType: contentType,
      Key: key,
    }));
  }

  async getObject(key: string): Promise<StoredObject> {
    validateObjectKey(key);
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));

    if (!result.Body) {
      throw new Error("对象不存在");
    }

    const body = await result.Body.transformToByteArray();
    return {
      body,
      contentType: result.ContentType || "application/octet-stream",
      size: result.ContentLength ?? body.byteLength,
    };
  }

  async deletePrefix(prefix: string) {
    validateWorkspacePrefix(prefix);
    let continuationToken: string | undefined;

    do {
      const result = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        Prefix: prefix,
      }));
      const objects = (result.Contents ?? []).flatMap((object) => (
        object.Key ? [{ Key: object.Key }] : []
      ));

      for (let index = 0; index < objects.length; index += 1_000) {
        const deleted = await this.client.send(new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: objects.slice(index, index + 1_000),
            Quiet: true,
          },
        }));

        if (deleted.Errors?.length) {
          throw new Error("对象删除不完整");
        }
      }

      continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
      if (result.IsTruncated && !continuationToken) {
        throw new Error("对象列表分页令牌缺失");
      }
    } while (continuationToken);
  }

  async deleteObject(key: string) {
    validateObjectKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function createObjectStorage(): ObjectStorage {
  if (process.env.OBJECT_STORAGE_DRIVER === "s3") {
    const bucket = process.env.S3_BUCKET?.trim();

    if (!bucket) {
      throw new Error("S3_BUCKET 未配置");
    }

    return new S3ObjectStorage({
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      bucket,
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      region: process.env.S3_REGION || "us-east-1",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    });
  }

  return new LocalObjectStorage();
}
