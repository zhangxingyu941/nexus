import type { EditorWorkspace } from "../model/block";
import { normalizeWorkspace } from "../model/workspaceOperations";
import type {
  DatabaseWorkspaceMember,
  EditorSessionUser,
  WorkspaceAccessRole,
} from "../session/sessionTypes";
import {
  loadWorkspace as loadLocalWorkspace,
  saveWorkspace as saveLocalWorkspace,
} from "./editorRepository";

export type WorkspaceLoadSource = "local" | "remote";
export type WorkspaceSaveTarget = "local" | "remote";

export interface SyncedWorkspaceResult {
  role?: WorkspaceAccessRole;
  source: WorkspaceLoadSource;
  user?: EditorSessionUser;
  workspace: EditorWorkspace | null;
}

interface RemoteWorkspaceResult {
  role?: WorkspaceAccessRole;
  user?: EditorSessionUser;
  workspace: EditorWorkspace | null;
}

async function fetchWorkspaceFromApi(): Promise<RemoteWorkspaceResult> {
  const response = await fetch("/api/workspace", {
    headers: { Accept: "application/json" },
    method: "GET",
  });

  if (!response.ok) {
    throw new Error("工作区接口读取失败");
  }

  const payload = await response.json();

  return {
    ...(payload.role ? { role: payload.role as WorkspaceAccessRole } : {}),
    ...(payload.user ? { user: payload.user as EditorSessionUser } : {}),
    workspace: payload.workspace ? normalizeWorkspace(payload.workspace) : null,
  };
}

async function saveWorkspaceToApi(workspace: EditorWorkspace) {
  const response = await fetch("/api/workspace", {
    body: JSON.stringify({ workspace }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error("工作区接口保存失败");
  }
}

export async function loadSyncedWorkspace(): Promise<SyncedWorkspaceResult> {
  try {
    const remote = await fetchWorkspaceFromApi();

    if (remote.workspace) {
      await saveLocalWorkspace(remote.workspace);
    }

    return {
      ...(remote.role ? { role: remote.role } : {}),
      source: "remote",
      ...(remote.user ? { user: remote.user } : {}),
      workspace: remote.workspace,
    };
  } catch {
    return {
      source: "local",
      workspace: await loadLocalWorkspace(),
    };
  }
}

export async function loadWorkspaceMembers(): Promise<DatabaseWorkspaceMember[]> {
  const response = await fetch("/api/workspace/members", {
    headers: { Accept: "application/json" },
    method: "GET",
  });

  return parseMemberResponse(response);
}

export async function addWorkspaceMember(email: string, role: Exclude<WorkspaceAccessRole, "owner">) {
  const response = await fetch("/api/workspace/members", {
    body: JSON.stringify({ email, role }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  return parseMemberResponse(response);
}

async function parseMemberResponse(response: Response): Promise<DatabaseWorkspaceMember[]> {
  const payload = await response.json() as { error?: string; members?: DatabaseWorkspaceMember[] };

  if (!response.ok || !payload.members) {
    throw new Error(payload.error || "工作区成员接口请求失败");
  }

  return payload.members;
}

export async function saveSyncedWorkspace(workspace: EditorWorkspace): Promise<WorkspaceSaveTarget> {
  await saveLocalWorkspace(workspace);

  try {
    await saveWorkspaceToApi(workspace);

    return "remote";
  } catch {
    // 后端暂时不可达时保留本地草稿，用户继续编辑不会丢内容。
    return "local";
  }
}
