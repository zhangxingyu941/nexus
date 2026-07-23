import { unzipSync, zipSync } from "fflate";

export const MARKDOWN_MAX_SOURCE_BYTES = 2 * 1024 * 1024;
export const MARKDOWN_ARCHIVE_MAX_ENTRIES = 200;
export const MARKDOWN_ARCHIVE_MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;

export interface MarkdownArchiveEntry {
  path: string;
  size: number;
}

export interface MarkdownArchiveResource {
  bytes: Uint8Array;
  mimeType: string;
  path: string;
}

export interface MarkdownArchiveCreateResource extends MarkdownArchiveResource {}

export type MarkdownArchiveValidationResult =
  | { ok: true }
  | { code: string; message: string; ok: false };

export type MarkdownArchiveDecodeResult =
  | { markdown: string; ok: true; resources: MarkdownArchiveResource[] }
  | { code: string; message: string; ok: false };

interface MarkdownArchiveManifest {
  formatVersion: 1;
  resources: Array<{ path: string; sha256: string; size: number }>;
}

interface ZipCentralDirectoryEntry extends MarkdownArchiveEntry {
  encrypted: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function validateMarkdownArchive(entries: MarkdownArchiveEntry[]): MarkdownArchiveValidationResult {
  if (entries.length > MARKDOWN_ARCHIVE_MAX_ENTRIES) {
    return archiveFailure("markdown_archive_entry_limit", "Archive contains too many entries");
  }

  let totalSize = 0;
  const paths = new Set<string>();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      return archiveFailure("markdown_archive_size_invalid", "Archive entry size is invalid");
    }
    if (!isSafeArchivePath(entry.path) || paths.has(entry.path)) {
      return archiveFailure("markdown_archive_path_invalid", "Archive entry path is invalid");
    }
    paths.add(entry.path);
    totalSize += entry.size;
    if (totalSize > MARKDOWN_ARCHIVE_MAX_UNCOMPRESSED_BYTES) {
      return archiveFailure("markdown_archive_size_limit", "Archive expands beyond the allowed size");
    }
  }

  if (!paths.has("document.md")) {
    return archiveFailure("markdown_archive_document_missing", "Archive must include document.md");
  }
  return { ok: true };
}

export async function decodeMarkdownUpload(
  filename: string,
  source: Uint8Array,
): Promise<MarkdownArchiveDecodeResult> {
  const lowerFilename = filename.trim().toLowerCase();
  if (lowerFilename.endsWith(".md")) {
    if (source.byteLength > MARKDOWN_MAX_SOURCE_BYTES) {
      return archiveFailure("markdown_source_size_limit", "Markdown source exceeds the allowed size");
    }
    const markdown = decodeUtf8(source);
    return typeof markdown === "string"
      ? { markdown, ok: true, resources: [] }
      : archiveFailure("markdown_utf8_invalid", "Markdown source is not valid UTF-8");
  }
  if (!lowerFilename.endsWith(".zip")) {
    return archiveFailure("markdown_file_type_invalid", "Only .md and .zip files are supported");
  }

  const centralDirectory = readZipCentralDirectory(source);
  if (!centralDirectory.ok) return centralDirectory;
  if (centralDirectory.entries.some((entry) => entry.encrypted)) {
    return archiveFailure("markdown_archive_encrypted", "Encrypted archive entries are not supported");
  }
  const validation = validateMarkdownArchive(centralDirectory.entries);
  if (!validation.ok) return validation;

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(source);
  } catch {
    return archiveFailure("markdown_archive_invalid", "Archive cannot be decoded");
  }

  const paths = Object.keys(files).sort();
  const expectedPaths = centralDirectory.entries.map((entry) => entry.path).sort();
  if (paths.length !== expectedPaths.length || paths.some((path, index) => path !== expectedPaths[index])) {
    return archiveFailure("markdown_archive_invalid", "Archive entries do not match its directory");
  }
  if (paths.some((path) => files[path]?.byteLength !== centralDirectory.byPath.get(path)?.size)) {
    return archiveFailure("markdown_archive_invalid", "Archive entry size does not match its directory");
  }

  const documentBytes = files["document.md"];
  if (!documentBytes || documentBytes.byteLength > MARKDOWN_MAX_SOURCE_BYTES) {
    return archiveFailure("markdown_source_size_limit", "Markdown source exceeds the allowed size");
  }
  const markdown = decodeUtf8(documentBytes);
  if (typeof markdown !== "string") {
    return archiveFailure("markdown_utf8_invalid", "Markdown source is not valid UTF-8");
  }
  const manifestBytes = files["manifest.json"];
  if (!manifestBytes) {
    return archiveFailure("markdown_archive_manifest_missing", "Archive must include manifest.json");
  }
  const manifest = parseManifest(manifestBytes);
  if (!manifest) {
    return archiveFailure("markdown_archive_manifest_invalid", "Archive manifest is invalid");
  }

  const resourcePaths = paths.filter((path) => path.startsWith("assets/"));
  if (manifest.resources.length !== resourcePaths.length) {
    return archiveFailure("markdown_archive_manifest_invalid", "Archive manifest resources are incomplete");
  }
  const manifestByPath = new Map(manifest.resources.map((resource) => [resource.path, resource]));
  if (manifestByPath.size !== manifest.resources.length || resourcePaths.some((path) => !manifestByPath.has(path))) {
    return archiveFailure("markdown_archive_manifest_invalid", "Archive manifest resources are invalid");
  }

  const resources: MarkdownArchiveResource[] = [];
  for (const path of resourcePaths) {
    const data = files[path]!;
    const manifestResource = manifestByPath.get(path)!;
    if (data.byteLength !== manifestResource.size || await sha256(data) !== manifestResource.sha256) {
      return archiveFailure("markdown_archive_hash_invalid", "Archive resource hash does not match its manifest");
    }
    resources.push({ bytes: data, mimeType: "application/octet-stream", path });
  }

  return { markdown, ok: true, resources };
}

export async function createMarkdownArchive(
  markdown: string,
  resources: MarkdownArchiveCreateResource[],
): Promise<Uint8Array> {
  const markdownBytes = encoder.encode(markdown);
  if (markdownBytes.byteLength > MARKDOWN_MAX_SOURCE_BYTES) {
    throw new RangeError("Markdown source exceeds the allowed size");
  }
  if (resources.some((resource) => !resource.path.startsWith("assets/"))) {
    throw new RangeError("Archive resources must be inside assets/");
  }

  const manifest: MarkdownArchiveManifest = {
    formatVersion: 1,
    resources: await Promise.all(resources.map(async (resource) => ({
      path: resource.path,
      sha256: await sha256(resource.bytes),
      size: resource.bytes.byteLength,
    }))),
  };
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  const validation = validateMarkdownArchive([
    { path: "document.md", size: markdownBytes.byteLength },
    { path: "manifest.json", size: manifestBytes.byteLength },
    ...resources.map((resource) => ({ path: resource.path, size: resource.bytes.byteLength })),
  ]);
  if (!validation.ok) throw new RangeError(validation.message);
  const output = {
    "document.md": markdownBytes,
    "manifest.json": manifestBytes,
    ...Object.fromEntries(resources.map((resource) => [resource.path, resource.bytes])),
  };
  return zipSync(output, { level: 9, mtime: new Date("1980-01-01T00:00:00.000Z") });
}

function readZipCentralDirectory(source: Uint8Array):
  | { byPath: Map<string, ZipCentralDirectoryEntry>; entries: ZipCentralDirectoryEntry[]; ok: true }
  | { code: string; message: string; ok: false } {
  const eocdOffset = findEndOfCentralDirectory(source);
  if (eocdOffset === -1 || eocdOffset + 22 > source.byteLength) {
    return archiveFailure("markdown_archive_invalid", "Archive end directory is missing");
  }

  const entryCount = readUint16(source, eocdOffset + 10);
  const centralDirectorySize = readUint32(source, eocdOffset + 12);
  const centralDirectoryOffset = readUint32(source, eocdOffset + 16);
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    centralDirectoryOffset + centralDirectorySize > source.byteLength
  ) {
    return archiveFailure("markdown_archive_invalid", "ZIP64 archives are not supported");
  }

  const entries: ZipCentralDirectoryEntry[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > source.byteLength || readUint32(source, offset) !== 0x02014b50) {
      return archiveFailure("markdown_archive_invalid", "Archive central directory is invalid");
    }
    const flags = readUint16(source, offset + 8);
    const compressedSize = readUint32(source, offset + 20);
    const size = readUint32(source, offset + 24);
    const nameLength = readUint16(source, offset + 28);
    const extraLength = readUint16(source, offset + 30);
    const commentLength = readUint16(source, offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > source.byteLength || compressedSize === 0xffffffff || size === 0xffffffff) {
      return archiveFailure("markdown_archive_invalid", "Archive entry is invalid");
    }
    const path = decodeUtf8(source.slice(offset + 46, offset + 46 + nameLength));
    if (typeof path !== "string") {
      return archiveFailure("markdown_archive_path_invalid", "Archive path is not valid UTF-8");
    }
    entries.push({ encrypted: (flags & 1) === 1, path, size });
    offset = end;
  }
  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    return archiveFailure("markdown_archive_invalid", "Archive central directory size is invalid");
  }

  return { byPath: new Map(entries.map((entry) => [entry.path, entry])), entries, ok: true };
}

function findEndOfCentralDirectory(source: Uint8Array) {
  for (let offset = source.byteLength - 22; offset >= Math.max(0, source.byteLength - 65_557); offset -= 1) {
    if (readUint32(source, offset) === 0x06054b50) return offset;
  }
  return -1;
}

function readUint16(source: Uint8Array, offset: number) {
  return source[offset]! | (source[offset + 1]! << 8);
}

function readUint32(source: Uint8Array, offset: number) {
  return readUint16(source, offset) | (readUint16(source, offset + 2) << 16 >>> 0);
}

function parseManifest(source: Uint8Array): MarkdownArchiveManifest | null {
  const text = decodeUtf8(source);
  if (typeof text !== "string") return null;
  try {
    const value = JSON.parse(text) as unknown;
    if (!isRecord(value) || value.formatVersion !== 1 || !Array.isArray(value.resources)) return null;
    const resources = value.resources.map((resource) => {
      if (!isRecord(resource)) return null;
      const { path, sha256: hash, size } = resource;
      if (
        typeof path !== "string" ||
        !isSafeArchivePath(path) ||
        !path.startsWith("assets/") ||
        !Number.isSafeInteger(size) ||
        typeof size !== "number" ||
        size < 0 ||
        typeof hash !== "string" ||
        !/^[a-f0-9]{64}$/.test(hash)
      ) return null;
      return { path, sha256: hash, size };
    });
    return resources.some((resource) => !resource) ? null : { formatVersion: 1, resources: resources as MarkdownArchiveManifest["resources"] };
  } catch {
    return null;
  }
}

function isSafeArchivePath(path: string) {
  if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  const segments = path.split("/");
  return segments.every((segment) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment) && segment !== "." && segment !== "..");
}

function decodeUtf8(source: Uint8Array) {
  try {
    return decoder.decode(source);
  } catch {
    return null;
  }
}

async function sha256(value: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", value as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function archiveFailure(code: string, message: string) {
  return { code, message, ok: false } as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
