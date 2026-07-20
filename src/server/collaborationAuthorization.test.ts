import { describe, expect, it, vi } from "vitest";
import { authorizeCollaborationRequest, isAllowedCollaborationOrigin } from "./collaborationAuthorization";

function createRequest(
  roomName = "workspace:workspace-a:document:document-1",
  cookie = "notion_editor_session=session-token",
) {
  return new Request(`http://localhost:1234/${encodeURIComponent(roomName)}`, {
    headers: { cookie },
  });
}

describe("collaboration WebSocket authorization", () => {
  it("rejects unauthenticated, unknown, and viewer document access", async () => {
    const authStore = { getUserBySessionToken: vi.fn().mockResolvedValue(null) };
    const documentAuthorization = { requireWorkspaceDocumentAction: vi.fn() };

    await expect(authorizeCollaborationRequest(createRequest(), { authStore, documentAuthorization })).resolves.toEqual({
      message: "请先登录",
      ok: false,
      status: 401,
    });

    authStore.getUserBySessionToken.mockResolvedValue({ id: "user-1" });
    documentAuthorization.requireWorkspaceDocumentAction.mockRejectedValueOnce(new Error("denied"));
    await expect(authorizeCollaborationRequest(createRequest(), { authStore, documentAuthorization })).resolves.toMatchObject({
      ok: false,
      status: 403,
    });

    documentAuthorization.requireWorkspaceDocumentAction.mockRejectedValueOnce(new Error("viewer denied"));
    await expect(authorizeCollaborationRequest(createRequest(), { authStore, documentAuthorization })).resolves.toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("allows editors to connect only to a valid document room", async () => {
    const authStore = { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "editor-1" }) };
    const documentAuthorization = {
      requireWorkspaceDocumentAction: vi.fn().mockResolvedValue({
        canWrite: true,
        role: "editor",
        workspaceId: "workspace-a",
      }),
    };

    await expect(authorizeCollaborationRequest(createRequest(), { authStore, documentAuthorization })).resolves.toEqual({
      access: { canWrite: true, role: "editor", workspaceId: "workspace-a" },
      documentId: "document-1",
      ok: true,
      roomName: "workspace:workspace-a:document:document-1",
      userId: "editor-1",
    });
    expect(documentAuthorization.requireWorkspaceDocumentAction).toHaveBeenCalledWith(
      "editor-1",
      "workspace-a",
      "document-1",
      "write",
    );

    await expect(authorizeCollaborationRequest(createRequest("other-room"), { authStore, documentAuthorization })).resolves.toMatchObject({
      ok: false,
      status: 400,
    });

    documentAuthorization.requireWorkspaceDocumentAction.mockResolvedValueOnce({
      canWrite: true,
      role: "editor",
      workspaceId: "workspace-b",
    });
    await expect(
      authorizeCollaborationRequest(createRequest(), { authStore, documentAuthorization }),
    ).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it("accepts only configured browser origins", () => {
    expect(isAllowedCollaborationOrigin("http://localhost:3000", ["http://localhost:3000"])).toBe(true);
    expect(isAllowedCollaborationOrigin("https://attacker.example", ["http://localhost:3000"])).toBe(false);
    expect(isAllowedCollaborationOrigin(undefined, ["http://localhost:3000"])).toBe(false);
  });
});
