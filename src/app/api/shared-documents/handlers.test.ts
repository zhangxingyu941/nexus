// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  DocumentShareGoneError,
  DocumentShareNotFoundError,
} from "../../../server/postgresDocumentShareStore";
import { createSharedDocumentHandlers } from "./handlers";

describe("shared document handlers", () => {
  it("returns a no-store public snapshot", async () => {
    const snapshot = {
      document: {
        blocks: [{
          children: [],
          content: "Public body",
          data: null,
          headingLevel: 1,
          id: "block-1",
          parentId: null,
          type: "paragraph",
        }],
        title: "Public document",
      },
      expiresAt: 100_000,
    };
    const store = { loadSharedDocument: vi.fn().mockResolvedValue(snapshot) };
    const response = await createSharedDocumentHandlers({ documentShareStore: store })
      .GET("raw-token");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(store.loadSharedDocument).toHaveBeenCalledWith("raw-token");
  });

  it.each([
    [new DocumentShareNotFoundError(), 404, "分享链接不存在"],
    [new DocumentShareGoneError(), 410, "分享链接已失效"],
  ])("maps anonymous failures without leaking document data", async (error, status, message) => {
    const store = { loadSharedDocument: vi.fn().mockRejectedValue(error) };
    const response = await createSharedDocumentHandlers({ documentShareStore: store })
      .GET("raw-token");

    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    await expect(response.json()).resolves.toEqual({ error: message });
  });
});
