import { NextResponse } from "next/server";
import type { PostgresAuthStore } from "../../../server/postgresAuthStore";
import type { PostgresWorkspaceStore } from "../../../server/postgresWorkspaceStore";
import { WorkspacePermissionError } from "../../../server/postgresWorkspaceStore";
import { getSessionToken } from "../../../server/sessionCookie";
import { isWorkspacePayload } from "../../../server/workspaceStore";

interface WorkspaceRouteDependencies {
  authStore: PostgresAuthStore;
  workspaceStore: PostgresWorkspaceStore;
}

export function createWorkspaceRouteHandlers({ authStore, workspaceStore }: WorkspaceRouteDependencies) {
  async function authenticate(request: Request) {
    return authStore.getUserBySessionToken(getSessionToken(request));
  }

  return {
    async GET(request: Request) {
      const user = await authenticate(request);

      if (!user) {
        return NextResponse.json({ error: "请先进入工作区" }, { status: 401 });
      }

      const loaded = await workspaceStore.loadWorkspace(user.id);

      return NextResponse.json({
        role: loaded?.role ?? null,
        user,
        workspace: loaded?.workspace ?? null,
      });
    },

    async PUT(request: Request) {
      const user = await authenticate(request);

      if (!user) {
        return NextResponse.json({ error: "请先进入工作区" }, { status: 401 });
      }

      const workspaceResult = await parseWorkspaceRequest(request);
      if (workspaceResult instanceof NextResponse) {
        return workspaceResult;
      }

      try {
        return NextResponse.json({
          saved: true,
          workspace: await workspaceStore.saveWorkspace(user.id, workspaceResult),
        });
      } catch (error) {
        if (error instanceof WorkspacePermissionError) {
          return NextResponse.json({ error: error.message }, { status: 403 });
        }

        throw error;
      }
    },
  };
}

export async function parseWorkspaceRequest(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "请求 JSON 格式不正确" }, { status: 400 });
  }

  const workspace = payload && typeof payload === "object" && "workspace" in payload
    ? (payload as { workspace: unknown }).workspace
    : payload;

  return isWorkspacePayload(workspace)
    ? workspace
    : NextResponse.json({ error: "工作区数据格式不正确" }, { status: 400 });
}
