// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { DocumentNotFoundError } from "../../../server/documentAuthorization";
import { createDocumentShareLinkHandlers } from "./handlers";

function createHandlers() {
  const authStore = { getUserBySessionToken: vi.fn() };
  const documentShareStore = {
    getManagedLink: vi.fn(),
    replaceManagedLink: vi.fn(),
    revokeManagedLink: vi.fn(),
  };
  return {
    authStore,
    documentShareStore,
    handlers: createDocumentShareLinkHandlers({ authStore, documentShareStore }),
  };
}

describe("document share link handlers", () => {
  it("requires authentication for every management action", async () => {
    const { authStore, documentShareStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue(null);

    const responses = await Promise.all([
      handlers.GET(request("GET"), "public-document-1"),
      handlers.POST(request("POST", {}), "public-document-1"),
      handlers.DELETE(request("DELETE"), "public-document-1"),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
    expect(documentShareStore.getManagedLink).not.toHaveBeenCalled();
    expect(documentShareStore.replaceManagedLink).not.toHaveBeenCalled();
    expect(documentShareStore.revokeManagedLink).not.toHaveBeenCalled();
  });

  it("returns only the managed link summary", async () => {
    const { authStore, documentShareStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "owner-1" });
    documentShareStore.getManagedLink.mockResolvedValue({
      expiresAt: 86_401_000,
      id: "share-1",
      status: "active",
    });

    const response = await handlers.GET(request("GET"), "public-document-1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      shareLink: {
        expiresAt: 86_401_000,
        id: "share-1",
        status: "active",
      },
    });
    expect(documentShareStore.getManagedLink).toHaveBeenCalledWith(
      "owner-1",
      "public-document-1",
    );
  });

  it("creates a link and returns its URL once", async () => {
    const { authStore, documentShareStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "owner-1" });
    documentShareStore.replaceManagedLink.mockResolvedValue({
      expiresAt: 86_401_000,
      id: "share-1",
      status: "active",
      url: "http://localhost/share/raw-token",
    });

    const response = await handlers.POST(
      request("POST", { expiresAt: 86_401_000 }),
      "public-document-1",
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      shareLink: {
        expiresAt: 86_401_000,
        id: "share-1",
        status: "active",
        url: "http://localhost/share/raw-token",
      },
    });
    expect(documentShareStore.replaceManagedLink).toHaveBeenCalledWith(
      "owner-1",
      "public-document-1",
      86_401_000,
    );
  });

  it("allows the store to apply the default expiration", async () => {
    const { authStore, documentShareStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "owner-1" });
    documentShareStore.replaceManagedLink.mockResolvedValue({
      expiresAt: 86_401_000,
      id: "share-1",
      status: "active",
      url: "http://localhost/share/raw-token",
    });

    const response = await handlers.POST(request("POST", {}), "public-document-1");

    expect(response.status).toBe(201);
    expect(documentShareStore.replaceManagedLink).toHaveBeenCalledWith(
      "owner-1",
      "public-document-1",
      undefined,
    );
  });

  it("rejects malformed input without calling the store", async () => {
    const { authStore, documentShareStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "owner-1" });

    const response = await handlers.POST(
      request("POST", { expiresAt: "tomorrow" }),
      "public-document-1",
    );

    expect(response.status).toBe(400);
    expect(documentShareStore.replaceManagedLink).not.toHaveBeenCalled();
  });

  it("maps denied management and expiry validation errors", async () => {
    const { authStore, documentShareStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "editor-1" });
    documentShareStore.getManagedLink.mockRejectedValue(new DocumentNotFoundError());
    documentShareStore.replaceManagedLink.mockRejectedValue(
      new TypeError("分享有效期不能超过 365 天"),
    );

    const denied = await handlers.GET(request("GET"), "public-document-1");
    const invalid = await handlers.POST(
      request("POST", { expiresAt: 999_999_999_999_999 }),
      "public-document-1",
    );

    expect(denied.status).toBe(404);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({ error: "分享有效期不能超过 365 天" });
  });

  it("revokes idempotently with an empty response", async () => {
    const { authStore, documentShareStore, handlers } = createHandlers();
    authStore.getUserBySessionToken.mockResolvedValue({ id: "owner-1" });
    documentShareStore.revokeManagedLink.mockResolvedValue(undefined);

    const response = await handlers.DELETE(request("DELETE"), "public-document-1");

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(documentShareStore.revokeManagedLink).toHaveBeenCalledWith(
      "owner-1",
      "public-document-1",
    );
  });
});

function request(method: string, body?: unknown) {
  return new Request("http://localhost/api/documents/public-document-1/share-links", {
    ...(body === undefined ? {} : {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
    method,
  });
}
