import { NextResponse } from "next/server";
import { workspaceErrorResponse } from "@/app/api/workspaceErrorResponse";
import type { PostgresAuthStore } from "@/server/postgresAuthStore";
import type { PostgresWorkspaceMemberStore } from "@/server/postgresWorkspaceMemberStore";
import { getSessionToken } from "@/server/sessionCookie";
import { WorkspaceDomainError } from "@/server/workspaceErrors";

interface WorkspaceMemberRouteDependencies {
  authStore: Pick<PostgresAuthStore, "getUserBySessionToken">;
  memberStore: Pick<PostgresWorkspaceMemberStore, "listMembers">;
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
