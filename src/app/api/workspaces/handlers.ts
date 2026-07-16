import { NextResponse } from "next/server";
import type { PostgresAuthStore } from "../../../server/postgresAuthStore";
import type { PostgresWorkspaceStore } from "../../../server/postgresWorkspaceStore";
import {
  WorkspaceNotFoundError,
  WorkspacePermissionError,
} from "../../../server/postgresWorkspaceStore";
import { getSessionToken } from "../../../server/sessionCookie";
import { isWorkspacePayload } from "../../../server/workspacePayload";
import { WorkspaceNameValidationError } from "../../../shared/workspace";

interface WorkspaceRouteDependencies {
  authStore: PostgresAuthStore;
  workspaceStore: PostgresWorkspaceStore;
}

export function createWorkspaceRouteHandlers({
  authStore,
  workspaceStore,
}: WorkspaceRouteDependencies) {
  async function authenticate(request: Request) {
    return authStore.getUserBySessionToken(getSessionToken(request));
  }

  return {
    async list(request: Request) {
      const user = await authenticate(request);
      if (!user) return unauthorizedResponse();

      return NextResponse.json(await workspaceStore.listWorkspaces(user.id));
    },

    async create(request: Request) {
      const user = await authenticate(request);
      if (!user) return unauthorizedResponse();

      const payload = await parseJson(request);
      if (payload instanceof NextResponse) return payload;
      const inputName = payload && typeof payload === "object"
        ? (payload as Record<string, unknown>).name
        : undefined;
      const name = typeof inputName === "string" ? inputName : "";

      try {
        return NextResponse.json(
          await workspaceStore.createWorkspace(user.id, name),
          { status: 201 },
        );
      } catch (error) {
        return mapWorkspaceError(error);
      }
    },

    async load(request: Request, workspaceId: string) {
      const user = await authenticate(request);
      if (!user) return unauthorizedResponse();

      try {
        return NextResponse.json(await workspaceStore.loadWorkspace(user.id, workspaceId));
      } catch (error) {
        return mapWorkspaceError(error);
      }
    },

    async rename(request: Request, workspaceId: string) {
      const user = await authenticate(request);
      if (!user) return unauthorizedResponse();

      const payload = await parseJson(request);
      if (payload instanceof NextResponse) return payload;
      const inputName = payload && typeof payload === "object"
        ? (payload as Record<string, unknown>).name
        : undefined;
      const name = typeof inputName === "string" ? inputName : "";

      try {
        return NextResponse.json({
          workspace: await workspaceStore.renameWorkspace(user.id, workspaceId, name),
        });
      } catch (error) {
        return mapWorkspaceError(error);
      }
    },

    async save(request: Request, workspaceId: string) {
      const user = await authenticate(request);
      if (!user) return unauthorizedResponse();

      const payload = await parseJson(request);
      if (payload instanceof NextResponse) return payload;
      const content = payload && typeof payload === "object" && "content" in payload
        ? (payload as { content: unknown }).content
        : undefined;
      if (!isWorkspacePayload(content)) {
        return jsonError("工作区数据格式不正确", 400);
      }

      try {
        await workspaceStore.saveWorkspace(user.id, workspaceId, content);
        return NextResponse.json({ saved: true });
      } catch (error) {
        return mapWorkspaceError(error);
      }
    },

    async select(request: Request, workspaceId: string) {
      const user = await authenticate(request);
      if (!user) return unauthorizedResponse();

      try {
        return NextResponse.json(await workspaceStore.selectWorkspace(user.id, workspaceId));
      } catch (error) {
        return mapWorkspaceError(error);
      }
    },
  };
}

export function workspaceServiceUnavailableResponse() {
  return jsonError("当前未启用 PostgreSQL 模式", 503);
}

async function parseJson(request: Request): Promise<unknown | NextResponse> {
  try {
    return await request.json();
  } catch {
    return jsonError("请求 JSON 格式不正确", 400);
  }
}

function mapWorkspaceError(error: unknown): NextResponse {
  if (error instanceof WorkspaceNameValidationError) {
    return jsonError(error.message, 400);
  }
  if (error instanceof WorkspaceNotFoundError) {
    return jsonError(error.message, 404);
  }
  if (error instanceof WorkspacePermissionError) {
    return jsonError(error.message, 403);
  }

  throw error;
}

function unauthorizedResponse() {
  return jsonError("请先进入工作区", 401);
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}
