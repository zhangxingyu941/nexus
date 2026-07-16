export type WorkspaceErrorCode =
  | "malformed_json"
  | "authentication_required"
  | "workspace_forbidden"
  | "workspace_not_found"
  | "service_unavailable"
  | "invite_role_required"
  | "invite_role_invalid"
  | "invite_email_mismatch"
  | "invite_not_found"
  | "already_member"
  | "invite_pending"
  | "invite_declined"
  | "invite_already_accepted"
  | "invite_expired"
  | "invite_revoked"
  | "invite_rate_limited"
  | "invite_context_missing"
  | "member_role_invalid"
  | "member_not_found"
  | "last_owner_protected"
  | "member_self_remove_forbidden"
  | "ownership_target_invalid"
  | "membership_conflict"
  | "workspace_name_confirmation_mismatch"
  | "workspace_deleted"
  | "workspace_purge_expired";

export class WorkspaceDomainError extends Error {
  constructor(
    readonly code: WorkspaceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceDomainError";
  }
}
