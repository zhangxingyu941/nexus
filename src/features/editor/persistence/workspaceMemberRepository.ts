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
