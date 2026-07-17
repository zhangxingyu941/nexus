import type { WorkspaceRole } from "../../../shared/workspace";
import type {
  DatabaseWorkspaceMember,
} from "../session/sessionTypes";

export async function loadWorkspaceMembers(
  workspaceId: string,
): Promise<DatabaseWorkspaceMember[]> {
  const response = await fetch(memberPath(workspaceId), {
    headers: { Accept: "application/json" },
    method: "GET",
  });

  return parseMemberResponse(response);
}

export async function updateWorkspaceMemberRole(
  workspaceId: string,
  memberId: string,
  role: WorkspaceRole,
): Promise<void> {
  const response = await fetch(
    `${memberPath(workspaceId)}/${encodeURIComponent(memberId)}`,
    {
      body: JSON.stringify({ role }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "PATCH",
    },
  );

  if (!response.ok) {
    const payload = await response.json() as { error?: string };
    throw new Error(payload.error || "更新成员角色失败");
  }
}

export async function removeWorkspaceMember(
  workspaceId: string,
  memberId: string,
): Promise<void> {
  const response = await fetch(
    `${memberPath(workspaceId)}/${encodeURIComponent(memberId)}`,
    {
      headers: { Accept: "application/json" },
      method: "DELETE",
    },
  );

  if (!response.ok) {
    const payload = await response.json() as { error?: string };
    throw new Error(payload.error || "移除成员失败");
  }
}

export async function leaveWorkspace(
  workspaceId: string,
): Promise<{ selectedWorkspaceId: string }> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/leave`,
    {
      headers: { Accept: "application/json" },
      method: "POST",
    },
  );

  const payload = await response.json() as {
    error?: string;
    selectedWorkspaceId?: string;
  };

  if (!response.ok || !payload.selectedWorkspaceId) {
    throw new Error(payload.error || "退出工作区失败");
  }

  return { selectedWorkspaceId: payload.selectedWorkspaceId };
}

function memberPath(workspaceId: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/members`;
}

async function parseMemberResponse(response: Response): Promise<DatabaseWorkspaceMember[]> {
  const payload = await response.json() as {
    error?: string;
    members?: DatabaseWorkspaceMember[];
  };

  if (!response.ok || !payload.members) {
    throw new Error(payload.error || "工作区成员接口请求失败");
  }

  return payload.members;
}
