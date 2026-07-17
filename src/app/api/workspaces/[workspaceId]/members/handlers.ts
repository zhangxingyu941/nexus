import { NextResponse } from "next/server";
import { workspaceErrorResponse } from "@/app/api/workspaceErrorResponse";
import type { WorkspaceRole } from "@/shared/workspace";
import type { PostgresAuthStore } from "@/server/postgresAuthStore";
import type { PostgresWorkspaceMemberStore } from "@/server/postgresWorkspaceMemberStore";
import { getSessionToken } from "@/server/sessionCookie";
import { WorkspaceDomainError } from "@/server/workspaceErrors";

interface WorkspaceMemberRouteDependencies {
  authStore: Pick<PostgresAuthStore, "getUserBySessionToken">;
  memberStore: Pick<
    PostgresWorkspaceMemberStore,
    | "leaveWorkspace"
    | "listMembers"
    | "removeMember"
    | "transferOwnership"
    | "updateRole"
  >;
}

export function createWorkspaceMemberRouteHandlers({
  authStore,
  memberStore,
}: WorkspaceMemberRouteDependencies) {
  async function authenticate(request: Request) {
    return authStore.getUserBySessionToken(getSessionToken(request));
  }

  return {
    async GET(request: Request, workspaceId: string) {
      const user = await authenticate(request);
      if (!user) return unauthorizedResponse();

      try {
        return NextResponse.json({
          members: await memberStore.listMembers(user.id, workspaceId),
        });
      } catch (error) {
        return mapMemberError(error);
      }
    },

    async PATCH(request: Request, workspaceId: string, memberId: string) {
      const user = await authenticate(request);
      if (!user) return unauthorizedResponse();

      const input = await parseRoleInput(request);
      if (input instanceof NextResponse) return input;

      try {
        await memberStore.updateRole({
          actorUserId: user.id,
          memberId,
          role: input.role,
          workspaceId,
        });
        return new NextResponse(null, { status: 204 });
      } catch (error) {
        return mapMemberError(error);
      }
    },

    async DELETE(request: Request, workspaceId: string, memberId: string) {
      const user = await authenticate(request);
      if (!user) return unauthorizedResponse();

      try {
        await memberStore.removeMember({
          actorUserId: user.id,
          memberId,
          workspaceId,
        });
        return new NextResponse(null, { status: 204 });
      } catch (error) {
        return mapMemberError(error);
      }
    },

    async leave(request: Request, workspaceId: string) {
      const user = await authenticate(request);
      if (!user) return unauthorizedResponse();

      try {
        const { selectedWorkspaceId } = await memberStore.leaveWorkspace({
          userDisplayName: user.displayName,
          userId: user.id,
          workspaceId,
        });
        return NextResponse.json({ selectedWorkspaceId });
      } catch (error) {
        return mapMemberError(error);
      }
    },

    async transferOwnership(request: Request, workspaceId: string) {
      const user = await authenticate(request);
      if (!user) return unauthorizedResponse();

      const input = await parseTransferInput(request);
      if (input instanceof NextResponse) return input;

      try {
        await memberStore.transferOwnership({
          actorUserId: user.id,
          retainOwnerRole: input.retainOwnerRole,
          targetUserId: input.targetUserId,
          workspaceId,
        });
        return new NextResponse(null, { status: 204 });
      } catch (error) {
        return mapMemberError(error);
      }
    },
  };
}

async function parseRoleInput(
  request: Request,
): Promise<NextResponse | { role: WorkspaceRole }> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return workspaceErrorResponse(new WorkspaceDomainError(
      "malformed_json",
      "Request body must be valid JSON",
    ))!;
  }

  const input = payload && typeof payload === "object"
    ? payload as { role?: unknown }
    : {};
  if (input.role === undefined || input.role === null || input.role === "") {
    return workspaceErrorResponse(new WorkspaceDomainError(
      "member_role_invalid",
      "Member role is required",
    ))!;
  }
  if (input.role !== "owner" && input.role !== "editor" && input.role !== "viewer") {
    return workspaceErrorResponse(new WorkspaceDomainError(
      "member_role_invalid",
      "Workspace member role must be owner, editor, or viewer",
    ))!;
  }

  return { role: input.role };
}

async function parseTransferInput(
  request: Request,
): Promise<NextResponse | { targetUserId: string; retainOwnerRole: boolean }> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return workspaceErrorResponse(new WorkspaceDomainError(
      "malformed_json",
      "Request body must be valid JSON",
    ))!;
  }

  const input = payload && typeof payload === "object"
    ? payload as { targetUserId?: unknown; retainOwnerRole?: unknown }
    : {};
  if (typeof input.targetUserId !== "string" || !input.targetUserId) {
    return workspaceErrorResponse(new WorkspaceDomainError(
      "ownership_target_invalid",
      "Target user ID is required",
    ))!;
  }

  return {
    retainOwnerRole: input.retainOwnerRole !== false,
    targetUserId: input.targetUserId,
  };
}

function unauthorizedResponse() {
  return workspaceErrorResponse(new WorkspaceDomainError(
    "authentication_required",
    "Authentication required",
  ))!;
}

function mapMemberError(error: unknown) {
  const response = workspaceErrorResponse(error);
  if (response) return response;
  throw error;
}
