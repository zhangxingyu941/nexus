import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadAttachment } from "./attachmentRepository";

describe("attachment repository", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uploads the exact file and requested block kind", async () => {
    const file = new File(["image"], "设计稿.png", { type: "image/png" });
    const attachment = {
      key: "local/object-1.png",
      kind: "image" as const,
      mimeType: "image/png",
      name: "设计稿.png",
      size: 5,
      url: "/api/files/local/object-1.png",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ attachment }), {
        headers: { "Content-Type": "application/json" },
        status: 201,
      }),
    );

    await expect(uploadAttachment(file, "image")).resolves.toEqual(attachment);
    const [, request] = fetchSpy.mock.calls[0];
    const body = request?.body as FormData;
    expect(body.get("kind")).toBe("image");
    expect(body.get("file")).toBe(file);
  });

  it("surfaces the file API error message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "图片块只能上传图片文件" }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      }),
    );

    await expect(
      uploadAttachment(new File(["pdf"], "方案.pdf", { type: "application/pdf" }), "image"),
    ).rejects.toThrow("图片块只能上传图片文件");
  });
});
