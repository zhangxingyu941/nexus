import { NextResponse } from "next/server";
import { workspaceErrorResponse } from "@/app/api/workspaceErrorResponse";
import {
  clearWorkspaceInviteContextCookie,
  setWorkspaceInviteContextCookie,
  WORKSPACE_INVITE_CONTEXT_COOKIE,
} from "@/app/api/workspace-invites/inviteContextCookie";
import type { PostgresAuthStore } from "@/server/postgresAuthStore";
import type { PostgresWorkspaceInviteStore } from "@/server/postgresWorkspaceInviteStore";
import type { PostgresWorkspaceStore } from "@/server/postgresWorkspaceStore";
import { getCookieValue, getSessionToken } from "@/server/sessionCookie";
import { WorkspaceDomainError } from "@/server/workspaceErrors";
import { WorkspaceInviteTokenService } from "@/server/workspaceInviteTokens";

interface WorkspaceInviteRecipientRouteDependencies {
  authStore: Pick<PostgresAuthStore, "getUserBySessionToken">;
  inviteStore: Pick<
    PostgresWorkspaceInviteStore,
    | "acceptInvite"
    | "declineInvite"
    | "listReceivedInvites"
    | "resolveRawToken"
  >;
  tokenService: WorkspaceInviteTokenService;
  workspaceStore: Pick<PostgresWorkspaceStore, "listWorkspaces" | "selectWorkspace">;
}

export function createWorkspaceInviteRecipientRouteHandlers({
  authStore,
  inviteStore,
  tokenService,
  workspaceStore,
}: WorkspaceInviteRecipientRouteDependencies) {
  async function authenticate(request: Request) {
    return authStore.getUserBySessionToken(getSessionToken(request));
  }

  async function acceptInvite(
    user: { email: string; id: string },
    inviteId: string,
    tokenHash: string | null,
  ) {
    const accepted = await inviteStore.acceptInvite({
      inviteId,
      tokenHash,
      userEmail: user.email,
      userId: user.id,
    });
    const workspace = await workspaceStore.selectWorkspace(user.id, accepted.workspaceId);
    const catalog = await workspaceStore.listWorkspaces(user.id);
    return NextResponse.json({ catalog, workspace });
  }

  async function declineInvite(
    user: { email: string; id: string },
    inviteId: string,
    tokenHash: string | null,
  ) {
    await inviteStore.declineInvite({
      inviteId,
      tokenHash,
      userEmail: user.email,
      userId: user.id,
    });
    return new NextResponse(null, { status: 204 });
  }

  async function transitionFromContext(
    request: Request,
    operation: (user: { email: string; id: string }, inviteId: string, tokenHash: string) => Promise<NextResponse>,
  ) {
    const user = await authenticate(request);
    if (!user) return authenticationRequiredResponse();

    const contextValue = getCookieValue(request, WORKSPACE_INVITE_CONTEXT_COOKIE);
    if (!contextValue) {
      return clearContextResponse(inviteContextMissingResponse());
    }

    let context: Awaited<ReturnType<WorkspaceInviteTokenService["verifyContext"]>>;
    try {
      context = await tokenService.verifyContext(contextValue);
    } catch {
      return clearContextResponse(inviteContextMissingResponse());
    }

    try {
      const response = await operation(user, context.inviteId, context.tokenHash);
      return clearContextResponse(response);
    } catch (error) {
      const response = mapInviteError(error);
      return isTerminalInviteError(error) ? clearContextResponse(response) : response;
    }
  }

  return {
    async list(request: Request) {
      const user = await authenticate(request);
      if (!user) return authenticationRequiredResponse();

      try {
        return NextResponse.json({
          invites: await inviteStore.listReceivedInvites(user.id, user.email),
        });
      } catch (error) {
        return mapInviteError(error);
      }
    },

    async resolve(request: Request) {
      const rawToken = await parseRawToken(request);
      if (!rawToken) return inviteNotFoundResponse();

      try {
        const invite = await inviteStore.resolveRawToken(rawToken);
        const context = await tokenService.signContext({
          expiresAt: invite.expiresAt,
          inviteId: invite.id,
          tokenHash: tokenService.hashRawToken(rawToken),
        });
        const response = NextResponse.json({ invite });
        setWorkspaceInviteContextCookie(response, context, invite.expiresAt);
        return response;
      } catch (error) {
        return mapInviteError(error);
      }
    },

    async acceptById(request: Request, inviteId: string) {
      const user = await authenticate(request);
      if (!user) return authenticationRequiredResponse();

      try {
        return await acceptInvite(user, inviteId, null);
      } catch (error) {
        return mapInviteError(error);
      }
    },

    async declineById(request: Request, inviteId: string) {
      const user = await authenticate(request);
      if (!user) return authenticationRequiredResponse();

      try {
        return await declineInvite(user, inviteId, null);
      } catch (error) {
        return mapInviteError(error);
      }
    },

    async acceptByContext(request: Request) {
      return transitionFromContext(request, acceptInvite);
    },

    async declineByContext(request: Request) {
      return transitionFromContext(request, declineInvite);
    },
  };
}

async function parseRawToken(request: Request) {
  try {
    const payload = await request.json() as unknown;
    if (!payload || typeof payload !== "object") return null;
    const token = (payload as { token?: unknown }).token;
    return typeof token === "string" && token.trim() ? token : null;
  } catch {
    return null;
  }
}

function authenticationRequiredResponse() {
  return workspaceErrorResponse(new WorkspaceDomainError(
    "authentication_required",
    "Authentication required",
  ))!;
}

function inviteContextMissingResponse() {
  return workspaceErrorResponse(new WorkspaceDomainError(
    "invite_context_missing",
    "Invitation context is missing or expired",
  ))!;
}

function inviteNotFoundResponse() {
  return workspaceErrorResponse(new WorkspaceDomainError(
    "invite_not_found",
    "Invitation not found",
  ))!;
}

function mapInviteError(error: unknown) {
  const response = workspaceErrorResponse(error);
  if (response) return response;
  throw error;
}

function clearContextResponse(response: NextResponse) {
  clearWorkspaceInviteContextCookie(response);
  return response;
}

function isTerminalInviteError(error: unknown) {
  return error instanceof WorkspaceDomainError
    && (
      error.code === "invite_already_accepted"
      || error.code === "invite_declined"
      || error.code === "invite_expired"
      || error.code === "invite_revoked"
    );
}
