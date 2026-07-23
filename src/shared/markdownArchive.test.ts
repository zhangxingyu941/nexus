// @vitest-environment node

import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  MARKDOWN_ARCHIVE_MAX_ENTRIES,
  MARKDOWN_ARCHIVE_MAX_UNCOMPRESSED_BYTES,
  MARKDOWN_MAX_SOURCE_BYTES,
  createMarkdownArchive,
  decodeMarkdownUpload,
  validateMarkdownArchive,
} from "./markdownArchive";

const encoder = new TextEncoder();

describe("markdown archive", () => {
  it.each(["../escape", "/absolute", "assets\\escape", "assets/a/../../b"])(
    "rejects unsafe archive path %s",
    (path) => {
      expect(validateMarkdownArchive([{ path, size: 1 }])).toMatchObject({
        code: "markdown_archive_path_invalid",
        ok: false,
      });
    },
  );

  it("requires document.md and limits entries and uncompressed bytes", () => {
    expect(validateMarkdownArchive([{ path: "assets/a.txt", size: 1 }])).toMatchObject({
      code: "markdown_archive_document_missing",
      ok: false,
    });
    expect(validateMarkdownArchive(Array.from({ length: MARKDOWN_ARCHIVE_MAX_ENTRIES + 1 }, (_, index) => ({
      path: index === 0 ? "document.md" : `assets/${index}.txt`,
      size: 1,
    })))).toMatchObject({ code: "markdown_archive_entry_limit", ok: false });
    expect(validateMarkdownArchive([{ path: "document.md", size: MARKDOWN_ARCHIVE_MAX_UNCOMPRESSED_BYTES + 1 }])).toMatchObject({
      code: "markdown_archive_size_limit",
      ok: false,
    });
  });

  it("encodes a deterministic complete archive and verifies its manifest on decode", async () => {
    const first = await createMarkdownArchive("# Export\n", [{
      bytes: encoder.encode("asset"),
      mimeType: "text/plain",
      path: "assets/readme.txt",
    }]);
    const second = await createMarkdownArchive("# Export\n", [{
      bytes: encoder.encode("asset"),
      mimeType: "text/plain",
      path: "assets/readme.txt",
    }]);

    expect(second).toEqual(first);
    const decoded = await decodeMarkdownUpload("export.zip", first);
    expect(decoded).toMatchObject({ ok: true, markdown: "# Export\n" });
    if (decoded.ok) {
      expect(decoded.resources).toEqual([expect.objectContaining({ path: "assets/readme.txt" })]);
      expect(new TextDecoder().decode(decoded.resources[0]?.bytes)).toBe("asset");
    }
  });

  it("rejects malformed manifests, invalid UTF-8, and source files over the limit", async () => {
    const malformed = zipSync({
      "document.md": encoder.encode("# Export\n"),
      "manifest.json": encoder.encode(JSON.stringify({
        formatVersion: 1,
        resources: [{ path: "assets/readme.txt", sha256: "0".repeat(64), size: 5 }],
      })),
      "assets/readme.txt": encoder.encode("asset"),
    });

    await expect(decodeMarkdownUpload("export.zip", malformed)).resolves.toMatchObject({
      code: "markdown_archive_hash_invalid",
      ok: false,
    });
    await expect(decodeMarkdownUpload("invalid.md", new Uint8Array([0xff]))).resolves.toMatchObject({
      code: "markdown_utf8_invalid",
      ok: false,
    });
    await expect(decodeMarkdownUpload("large.md", new Uint8Array(MARKDOWN_MAX_SOURCE_BYTES + 1))).resolves.toMatchObject({
      code: "markdown_source_size_limit",
      ok: false,
    });
  });
});
