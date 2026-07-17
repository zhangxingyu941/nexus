import type { WorkspaceTransitionResponse } from "../../../shared/workspaceApi";
import type {
  ReceivedWorkspaceInvite,
  WorkspaceInviteMutationResponse,
  WorkspaceInviteRole,
  WorkspaceInviteSummary,
} from "../../../shared/workspaceInvites";
import { jsonRequest, requestJson } from "./apiClient";

export interface WorkspaceInviteRepository {
  listReceived(): Promise<ReceivedWorkspaceInvite[]>;
  listSent(workspaceId: string): Promise<WorkspaceInviteSummary[]>;
  create(
    workspaceId: string,
    email: string,
    role: WorkspaceInviteRole,
  ): Promise<WorkspaceInviteMutationResponse>;
  resend(workspaceId: string, inviteId: string): Promise<WorkspaceInviteMutationResponse>;
  revoke(workspaceId: string, inviteId: string): Promise<void>;
  acceptReceived(inviteId: string): Promise<WorkspaceTransitionResponse>;
  declineReceived(inviteId: string): Promise<void>;
}

export const workspaceInviteRepository: WorkspaceInviteRepository = {
  listReceived: () => requestJson<{ invites: ReceivedWorkspaceInvite[] }>(
    "/api/workspace-invites",
    jsonRequest("GET"),
  ).then((payload) => payload.invites),
  listSent: (workspaceId) => requestJson<{ invites: WorkspaceInviteSummary[] }>(
    workspaceInvitesPath(workspaceId),
    jsonRequest("GET"),
  ).then((payload) => payload.invites),
  create: (workspaceId, email, role) => requestJson<WorkspaceInviteMutationResponse>(
    workspaceInvitesPath(workspaceId),
    jsonRequest("POST", { email, role }),
  ),
  resend: (workspaceId, inviteId) => requestJson<WorkspaceInviteMutationResponse>(
    `${sentInvitePath(workspaceId, inviteId)}/resend`,
    jsonRequest("POST"),
  ),
  revoke: (workspaceId, inviteId) => requestJson<void>(
    sentInvitePath(workspaceId, inviteId),
    jsonRequest("DELETE"),
  ),
  acceptReceived: (inviteId) => requestJson<WorkspaceTransitionResponse>(
    `${receivedInvitePath(inviteId)}/accept`,
    jsonRequest("POST"),
  ),
  declineReceived: (inviteId) => requestJson<void>(
    `${receivedInvitePath(inviteId)}/decline`,
    jsonRequest("POST"),
  ),
};

function workspaceInvitesPath(workspaceId: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/invites`;
}

function sentInvitePath(workspaceId: string, inviteId: string) {
  return `${workspaceInvitesPath(workspaceId)}/${encodeURIComponent(inviteId)}`;
}

function receivedInvitePath(inviteId: string) {
  return `/api/workspace-invites/${encodeURIComponent(inviteId)}`;
}
