import { NextResponse } from "next/server";
import {
  WorkspaceDomainError,
  type WorkspaceErrorCode,
} from "../../server/workspaceErrors";

const STATUS_BY_CODE: Record<WorkspaceErrorCode, number> = {
  malformed_json: 400,
  authentication_required: 401,
  workspace_forbidden: 403,
  workspace_not_found: 404,
  service_unavailable: 503,
  invite_role_required: 400,
  invite_role_invalid: 400,
  invite_email_mismatch: 403,
  invite_not_found: 404,
  already_member: 409,
  invite_pending: 409,
  invite_declined: 409,
  invite_already_accepted: 409,
  invite_expired: 410,
  invite_revoked: 410,
  invite_rate_limited: 429,
  invite_context_missing: 401,
  member_role_invalid: 400,
  member_not_found: 404,
  last_owner_protected: 409,
  member_self_remove_forbidden: 409,
  ownership_target_invalid: 409,
  membership_conflict: 409,
  workspace_name_confirmation_mismatch: 400,
  workspace_deleted: 410,
  workspace_purge_expired: 410,
};

export function workspaceErrorResponse(
  error: unknown,
  retryAfterSeconds?: number,
) {
  if (!(error instanceof WorkspaceDomainError)) {
    return null;
  }

  return NextResponse.json(
    {
      code: error.code,
      error: error.message,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
    { status: STATUS_BY_CODE[error.code] },
  );
}
