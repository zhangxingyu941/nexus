import { NextResponse } from "next/server";
import { workspaceErrorResponse } from "@/app/api/workspaceErrorResponse";
import type { PostgresAuthStore } from "@/server/postgresAuthStore";
import type { PostgresWorkspaceLifecycleStore } from "@/server/postgresWorkspaceLifecycleStore";
import type { PostgresWorkspaceStore } from "@/server/postgresWorkspaceStore";
import { getSessionToken } from "@/server/sessionCookie";
import { WorkspaceDomainError } from "@/server/workspaceErrors";

interface WorkspaceLifecycleRouteDependencies {
  authStore: Pick<PostgresAuthStore, "getUserBySessionToken">;
  lifecycleStore: Pick<
    PostgresWorkspaceLifecycleStore,
    "deleteWorkspace" | "getDeletionSummary" | "listTrash" | "restoreWorkspace"
  >;
  workspaceStore: Pick<
    PostgresWorkspaceStore,
    "ensurePersonalWorkspace" | "listWorkspaces" | "loadWorkspace"
  >;
}

export function createWorkspaceLifecycleRouteHandlers({
  authStore,
  lifecycleStore,
  workspaceStore,
}: WorkspaceLifecycleRouteDependencies) {
  async function authenticate(request: Request) {
    return authStore.getUserBySessionToken(getSessionToken(request));
  }

  return {
    async GET(request: Request, workspaceId: string) {
      const user = await authenticate(request);
      if (!user) return authenticationRequiredResponse();

      try {
        return NextResponse.json({
          summary: await lifecycleStore.getDeletionSummary(user.id, workspaceId),
        });
      } catch (error) {
        return mapLifecycleError(error);
      }
    },

    async DELETE(request: Request, workspaceId: string) {
      const user = await authenticate(request);
      if (!user) return authenticationRequiredResponse();

      const confirmationName = await parseConfirmationName(request);
      if (confirmationName instanceof NextResponse) return confirmationName;

      try {
        const deletedWorkspace = await lifecycleStore.deleteWorkspace({
          actorUserId: user.id,
          confirmationName,
          workspaceId,
        });
        await workspaceStore.ensurePersonalWorkspace(
          user.id,
          `${user.displayName}的工作区`,
        );
        const catalog = await workspaceStore.listWorkspaces(user.id);
        const workspace = await workspaceStore.loadWorkspace(
          user.id,
          catalog.currentWorkspaceId,
        );
        return NextResponse.json({ catalog, deletedWorkspace, workspace });
      } catch (error) {
        return mapLifecycleError(error);
      }
    },

    async listTrash(request: Request) {
      const user = await authenticate(request);
      if (!user) return authenticationRequiredResponse();

      try {
        return NextResponse.json({
          workspaces: await lifecycleStore.listTrash(user.id),
        });
      } catch (error) {
        return mapLifecycleError(error);
      }
    },

    async restore(request: Request, workspaceId: string) {
      const user = await authenticate(request);
      if (!user) return authenticationRequiredResponse();

      try {
        await lifecycleStore.restoreWorkspace(user.id, workspaceId);
        const catalog = await workspaceStore.listWorkspaces(user.id);
        const workspace = await workspaceStore.loadWorkspace(user.id, workspaceId);
        return NextResponse.json({ catalog, workspace });
      } catch (error) {
        return mapLifecycleError(error);
      }
    },
  };
}

async function parseConfirmationName(request: Request): Promise<NextResponse | string> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return workspaceErrorResponse(new WorkspaceDomainError(
      "malformed_json",
      "Request body must be valid JSON",
    ))!;
  }
  const confirmationName = payload && typeof payload === "object"
    ? (payload as { confirmationName?: unknown }).confirmationName
    : undefined;
  if (typeof confirmationName !== "string") {
    return workspaceErrorResponse(new WorkspaceDomainError(
      "workspace_name_confirmation_mismatch",
      "Workspace name confirmation does not match",
    ))!;
  }
  return confirmationName;
}

function authenticationRequiredResponse() {
  return workspaceErrorResponse(new WorkspaceDomainError(
    "authentication_required",
    "Authentication required",
  ))!;
}

function mapLifecycleError(error: unknown) {
  const response = workspaceErrorResponse(error);
  if (response) return response;
  throw error;
}
