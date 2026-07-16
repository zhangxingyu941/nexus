export type WorkspaceInviteRole = "editor" | "viewer";

export type WorkspaceInviteStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "revoked"
  | "expired";

export interface WorkspaceInviteSummary {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceInviteRole;
  status: WorkspaceInviteStatus;
  deliveryStatus: "pending" | "sent" | "failed";
  invitedBy: { id: string; displayName: string };
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  lastSentAt: number | null;
}

export interface ReceivedWorkspaceInvite {
  id: string;
  workspaceId: string;
  workspaceName: string;
  invitedBy: { id: string; displayName: string };
  role: WorkspaceInviteRole;
  maskedEmail: string;
  expiresAt: number;
}

export interface WorkspaceInviteMutationResponse {
  invite: WorkspaceInviteSummary;
  deliveryWarning: null | {
    code: "invite_delivery_failed";
    error: string;
  };
}
