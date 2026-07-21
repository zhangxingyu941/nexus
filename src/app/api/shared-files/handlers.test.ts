// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  DocumentShareGoneError,
  DocumentShareNotFoundError,
} from "../../../server/postgresDocumentShareStore";
import { createSharedFileHandlers } from "./handlers";

describe("shared file handlers", () => {
  it("returns an authorized object without caching it", async () => {
    const store = {
      loadSharedAttachment: vi.fn().mockResolvedValue({
        body: new TextEncoder().encode("file-body"),
        contentType: "application/pdf",
        size: 9,
      }),
    };
    const handlers = createSharedFileHandlers({ documentShareStore: store });
    const response = await handlers.GET(
      request("?expiresAt=100000&signature=" + "a".repeat(64)),
      { keyToken: "a2V5", shareId: "share-1" },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    await expect(response.text()).resolves.toBe("file-body");
    expect(store.loadSharedAttachment).toHaveBeenCalledWith({
      expiresAt: 100_000,
      keyToken: "a2V5",
      shareId: "share-1",
      signature: "a".repeat(64),
    });
  });

  it("rejects malformed signed parameters before reading storage", async () => {
    const store = { loadSharedAttachment: vi.fn() };
    const response = await createSharedFileHandlers({ documentShareStore: store }).GET(
      request("?expiresAt=tomorrow&signature=bad"),
      { keyToken: "a2V5", shareId: "share-1" },
    );

    expect(response.status).toBe(404);
    expect(store.loadSharedAttachment).not.toHaveBeenCalled();
  });

  it.each([
    [new DocumentShareNotFoundError(), 404],
    [new DocumentShareGoneError(), 410],
  ])("maps attachment authorization failures", async (error, status) => {
    const store = { loadSharedAttachment: vi.fn().mockRejectedValue(error) };
    const response = await createSharedFileHandlers({ documentShareStore: store }).GET(
      request("?expiresAt=100000&signature=" + "a".repeat(64)),
      { keyToken: "a2V5", shareId: "share-1" },
    );

    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});

function request(search: string) {
  return new Request(`http://localhost/api/shared-files/share-1/a2V5${search}`);
}
