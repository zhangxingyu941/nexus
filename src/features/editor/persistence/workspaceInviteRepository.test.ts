import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ReceivedWorkspaceInvite,
  WorkspaceInviteMutationResponse,
  WorkspaceInviteSummary,
} from "../../../shared/workspaceInvites";
import { workspaceInviteRepository } from "./workspaceInviteRepository";

describe("workspaceInviteRepository", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists received and sent invitations through the exact endpoints", async () => {
    const received = [receivedInvite()];
    const sent = [sentInvite()];
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ invites: received }))
      .mockResolvedValueOnce(jsonResponse({ invites: sent }));

    await expect(workspaceInviteRepository.listReceived()).resolves.toEqual(received);
    await expect(workspaceInviteRepository.listSent("workspace/a")).resolves.toEqual(sent);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/workspace-invites",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/workspaces/workspace%2Fa/invites",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("creates and resends invitations with exact payloads and encoded path parameters", async () => {
    const mutation: WorkspaceInviteMutationResponse = {
      deliveryWarning: null,
      invite: sentInvite(),
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(mutation, 201))
      .mockResolvedValueOnce(jsonResponse(mutation));

    await expect(workspaceInviteRepository.create(
      "workspace/a",
      "member@example.com",
      "editor",
    )).resolves.toEqual(mutation);
    await expect(workspaceInviteRepository.resend("workspace/a", "invite/b"))
      .resolves.toEqual(mutation);

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/workspaces/workspace%2Fa/invites",
      expect.objectContaining({
        body: JSON.stringify({ email: "member@example.com", role: "editor" }),
        method: "POST",
      }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/workspaces/workspace%2Fa/invites/invite%2Fb/resend",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("accepts and declines received invitations through encoded endpoints", async () => {
    const transition = { catalog: { currentWorkspaceId: "workspace-1", workspaces: [] }, workspace: {} };
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(transition))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(workspaceInviteRepository.acceptReceived("invite/a"))
      .resolves.toEqual(transition);
    await expect(workspaceInviteRepository.declineReceived("invite/a"))
      .resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "/api/workspace-invites/invite%2Fa/accept",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "/api/workspace-invites/invite%2Fa/decline",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("revokes a sent invitation through encoded workspace and invite paths", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(workspaceInviteRepository.revoke("workspace/a", "invite/b"))
      .resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/workspaces/workspace%2Fa/invites/invite%2Fb",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

function receivedInvite(): ReceivedWorkspaceInvite {
  return {
    expiresAt: 86_400_000,
    id: "invite-1",
    invitedBy: { displayName: "Owner", id: "owner-1" },
    maskedEmail: "m***@example.com",
    role: "editor",
    workspaceId: "workspace-1",
    workspaceName: "Alpha",
  };
}

function sentInvite(): WorkspaceInviteSummary {
  return {
    createdAt: 1_000,
    deliveryStatus: "sent",
    email: "member@example.com",
    expiresAt: 86_400_000,
    id: "invite-1",
    invitedBy: { displayName: "Owner", id: "owner-1" },
    lastSentAt: 1_000,
    role: "editor",
    status: "pending",
    updatedAt: 1_000,
    workspaceId: "workspace-1",
  };
}

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
