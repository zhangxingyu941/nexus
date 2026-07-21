import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocumentShareRepository } from "./documentShareRepository";

const summary = {
  expiresAt: 86_401_000,
  id: "share-1",
  status: "active" as const,
};

describe("document share repository", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads, creates, and revokes through an encoded public document id", async () => {
    const created = { ...summary, url: "http://localhost/share/raw-token" };
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ shareLink: summary }))
      .mockResolvedValueOnce(jsonResponse({ shareLink: created }, 201))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    const repository = createDocumentShareRepository();

    await expect(repository.load("public/document-1")).resolves.toEqual(summary);
    await expect(repository.create("public/document-1", 86_401_000))
      .resolves.toEqual(created);
    await expect(repository.revoke("public/document-1")).resolves.toBeUndefined();

    const url = "/api/documents/public%2Fdocument-1/share-links";
    expect(fetchSpy).toHaveBeenNthCalledWith(1, url, expect.objectContaining({ method: "GET" }));
    expect(fetchSpy).toHaveBeenNthCalledWith(2, url, expect.objectContaining({
      body: JSON.stringify({ expiresAt: 86_401_000 }),
      method: "POST",
    }));
    expect(fetchSpy).toHaveBeenNthCalledWith(3, url, expect.objectContaining({ method: "DELETE" }));
  });

  it("returns null when no managed link exists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ shareLink: null })));

    await expect(createDocumentShareRepository().load("public-document-1"))
      .resolves.toBeNull();
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
