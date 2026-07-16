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
    const workspaceStore = { getDocumentAccess: vi.fn() };

    await expect(authorizeCollaborationRequest(createRequest(), { authStore, workspaceStore })).resolves.toEqual({
      message: "请先登录",
      ok: false,
      status: 401,
    });

    authStore.getUserBySessionToken.mockResolvedValue({ id: "user-1" });
    workspaceStore.getDocumentAccess.mockResolvedValueOnce(null);
    await expect(authorizeCollaborationRequest(createRequest(), { authStore, workspaceStore })).resolves.toMatchObject({
      ok: false,
      status: 403,
    });

    workspaceStore.getDocumentAccess.mockResolvedValueOnce({ role: "viewer", workspaceId: "workspace-a" });
    await expect(authorizeCollaborationRequest(createRequest(), { authStore, workspaceStore })).resolves.toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("allows editors to connect only to a valid document room", async () => {
    const authStore = { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "editor-1" }) };
    const workspaceStore = {
      getDocumentAccess: vi.fn().mockResolvedValue({ role: "editor", workspaceId: "workspace-a" }),
    };

    await expect(authorizeCollaborationRequest(createRequest(), { authStore, workspaceStore })).resolves.toEqual({
      access: { role: "editor", workspaceId: "workspace-a" },
      documentId: "document-1",
      ok: true,
      roomName: "workspace:workspace-a:document:document-1",
      userId: "editor-1",
    });
    expect(workspaceStore.getDocumentAccess).toHaveBeenCalledWith(
      "editor-1",
      "workspace-a",
      "document-1",
    );

    await expect(authorizeCollaborationRequest(createRequest("other-room"), { authStore, workspaceStore })).resolves.toMatchObject({
      ok: false,
      status: 400,
    });

    workspaceStore.getDocumentAccess.mockResolvedValueOnce({ role: "editor", workspaceId: "workspace-b" });
    await expect(
      authorizeCollaborationRequest(createRequest(), { authStore, workspaceStore }),
    ).resolves.toMatchObject({ ok: false, status: 403 });
  });

  it("accepts only configured browser origins", () => {
    expect(isAllowedCollaborationOrigin("http://localhost:3000", ["http://localhost:3000"])).toBe(true);
    expect(isAllowedCollaborationOrigin("https://attacker.example", ["http://localhost:3000"])).toBe(false);
    expect(isAllowedCollaborationOrigin(undefined, ["http://localhost:3000"])).toBe(false);
  });
});
