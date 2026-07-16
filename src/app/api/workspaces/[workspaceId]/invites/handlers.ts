import { NextResponse } from "next/server";
import { workspaceErrorResponse } from "@/app/api/workspaceErrorResponse";
import type { WorkspaceInviteRole } from "@/shared/workspaceInvites";
import type { PostgresAuthStore } from "@/server/postgresAuthStore";
import type { PostgresWorkspaceInviteStore } from "@/server/postgresWorkspaceInviteStore";
import { getSessionToken } from "@/server/sessionCookie";
import { WorkspaceDomainError } from "@/server/workspaceErrors";
import {
  WorkspaceInviteRateLimitUnavailableError,
  type WorkspaceInviteRateLimiter,
} from "@/server/workspaceInviteRateLimiter";
import type { WorkspaceInviteMailer } from "@/server/workspaceInviteMailer";

interface WorkspaceInviteRouteDependencies {
  appUrl: string;
  authStore: Pick<PostgresAuthStore, "getUserBySessionToken">;
  inviteStore: Pick<
    PostgresWorkspaceInviteStore,
    | "assertOwnerAccess"
    | "createInvite"
    | "listOwnerInvites"
    | "markDeliveryResult"
    | "resendInvite"
    | "revokeInvite"
  >;
  limiter: WorkspaceInviteRateLimiter;
  mailer: Pick<WorkspaceInviteMailer, "send">;
}

type PendingInviteDelivery = Awaited<
  ReturnType<WorkspaceInviteRouteDependencies["inviteStore"]["createInvite"]>
>;

type ParsedCreateInput = {
  email: string;
  role: WorkspaceInviteRole;
};

export function createWorkspaceInviteRouteHandlers({
  appUrl,
  authStore,
  inviteStore,
  limiter,
  mailer,
}: WorkspaceInviteRouteDependencies) {
  async function authenticate(request: Request) {
    return authStore.getUserBySessionToken(getSessionToken(request));
  }

  return {
    async GET(request: Request, workspaceId: string) {
      const user = await authenticate(request);
      if (!user) return authenticationRequiredResponse();

      try {
        return NextResponse.json({
          invites: await inviteStore.listOwnerInvites(user.id, workspaceId),
        });
      } catch (error) {
        return mapInviteError(error);
      }
    },

    async POST(request: Request, workspaceId: string) {
      const user = await authenticate(request);
      if (!user) return authenticationRequiredResponse();

      const input = await parseCreateInput(request);
      if (input instanceof NextResponse) return input;

      try {
        await inviteStore.assertOwnerAccess(user.id, workspaceId);
        const rateLimit = await limiter.consume(workspaceId, input.email);
        if (!rateLimit.allowed) {
          return workspaceErrorResponse(new WorkspaceDomainError(
            "invite_rate_limited",
            "Invitation rate limit exceeded",
          ), Math.ceil(rateLimit.retryAfterMs / 1_000))!;
        }

        const created = await inviteStore.createInvite({
          actorUserId: user.id,
          email: input.email,
          role: input.role,
          workspaceId,
        });
        return deliverInvitation(user.id, workspaceId, created, 201);
      } catch (error) {
        return mapInviteError(error);
      }
    },

    async resend(request: Request, workspaceId: string, inviteId: string) {
      const user = await authenticate(request);
      if (!user) return authenticationRequiredResponse();

      try {
        const resent = await inviteStore.resendInvite(user.id, workspaceId, inviteId);
        return deliverInvitation(user.id, workspaceId, resent, 200);
      } catch (error) {
        return mapInviteError(error);
      }
    },

    async DELETE(request: Request, workspaceId: string, inviteId: string) {
      const user = await authenticate(request);
      if (!user) return authenticationRequiredResponse();

      try {
        await inviteStore.revokeInvite(user.id, workspaceId, inviteId);
        return new NextResponse(null, { status: 204 });
      } catch (error) {
        return mapInviteError(error);
      }
    },
  };

  async function deliverInvitation(
    actorUserId: string,
    workspaceId: string,
    pendingDelivery: PendingInviteDelivery,
    status: number,
  ) {
    try {
      await mailer.send({
        email: pendingDelivery.invite.email,
        inviterDisplayName: pendingDelivery.invite.invitedBy.displayName,
        role: pendingDelivery.invite.role,
        url: invitationUrl(appUrl, pendingDelivery.rawToken),
        workspaceName: pendingDelivery.workspaceName,
      });
    } catch {
      const invite = await inviteStore.markDeliveryResult(
        actorUserId,
        workspaceId,
        pendingDelivery.invite.id,
        pendingDelivery.rawToken,
        "failed",
      );
      return NextResponse.json({
        deliveryWarning: {
          code: "invite_delivery_failed",
          error: "Invitation email could not be delivered",
        },
        invite: invite ?? pendingDelivery.invite,
      }, { status });
    }

    const invite = await inviteStore.markDeliveryResult(
      actorUserId,
      workspaceId,
      pendingDelivery.invite.id,
      pendingDelivery.rawToken,
      "sent",
    );
    return NextResponse.json({
      deliveryWarning: null,
      invite: invite ?? pendingDelivery.invite,
    }, { status });
  }
}

async function parseCreateInput(
  request: Request,
): Promise<NextResponse | ParsedCreateInput> {
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
    ? payload as { email?: unknown; role?: unknown }
    : {};
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return workspaceErrorResponse(new WorkspaceDomainError(
      "malformed_json",
      "Invitation email must be valid",
    ))!;
  }
  if (input.role === undefined || input.role === null || input.role === "") {
    return workspaceErrorResponse(new WorkspaceDomainError(
      "invite_role_required",
      "Invitation role is required",
    ))!;
  }
  if (input.role !== "editor" && input.role !== "viewer") {
    return workspaceErrorResponse(new WorkspaceDomainError(
      "invite_role_invalid",
      "Invitation role must be editor or viewer",
    ))!;
  }

  return { email, role: input.role };
}

function authenticationRequiredResponse() {
  return workspaceErrorResponse(new WorkspaceDomainError(
    "authentication_required",
    "Authentication required",
  ))!;
}

function mapInviteError(error: unknown) {
  if (error instanceof WorkspaceInviteRateLimitUnavailableError) {
    return workspaceErrorResponse(new WorkspaceDomainError(
      "service_unavailable",
      "Workspace invitation service is unavailable",
    ))!;
  }
  const response = workspaceErrorResponse(error);
  if (response) return response;
  throw error;
}

function invitationUrl(appUrl: string, rawToken: string) {
  return `${appUrl.replace(/\/+$/, "")}/invitations/accept#token=${encodeURIComponent(rawToken)}`;
}
