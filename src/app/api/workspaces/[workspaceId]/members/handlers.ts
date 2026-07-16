import { NextResponse } from "next/server";
import type { PostgresAuthStore } from "@/server/postgresAuthStore";
import type { PostgresWorkspaceStore } from "@/server/postgresWorkspaceStore";
import {
  WorkspaceMemberNotFoundError,
  WorkspaceNotFoundError,
  WorkspacePermissionError,
} from "@/server/postgresWorkspaceStore";
import { getSessionToken } from "@/server/sessionCookie";

interface WorkspaceMemberRouteDependencies {
  authStore: PostgresAuthStore;
  workspaceStore: PostgresWorkspaceStore;
}

export function createWorkspaceMemberRouteHandlers({
  authStore,
  workspaceStore,
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
          members: await workspaceStore.listMembers(user.id, workspaceId),
        });
      } catch (error) {
        return mapMemberError(error);
      }
    },

    async POST(request: Request, workspaceId: string) {
      const user = await authenticate(request);
      if (!user) return unauthorizedResponse();

      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return NextResponse.json({ error: "请求 JSON 格式不正确" }, { status: 400 });
      }

      const input = payload && typeof payload === "object"
        ? payload as { email?: unknown; role?: unknown }
        : {};
      const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
      const role = input.role;

      if (!email || (role !== "editor" && role !== "viewer")) {
        return NextResponse.json({ error: "成员邮箱或角色不正确" }, { status: 400 });
      }

      try {
        await workspaceStore.addMember(user.id, workspaceId, email, role);
        return NextResponse.json(
          { members: await workspaceStore.listMembers(user.id, workspaceId) },
          { status: 201 },
        );
      } catch (error) {
        return mapMemberError(error);
      }
    },
  };
}

function unauthorizedResponse() {
  return NextResponse.json({ error: "请先进入工作区" }, { status: 401 });
}

function mapMemberError(error: unknown) {
  if (error instanceof WorkspaceNotFoundError || error instanceof WorkspaceMemberNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof WorkspacePermissionError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  throw error;
}
