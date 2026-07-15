import type { WorkspaceRole } from "../../../shared/workspace";

export interface EditorSessionUser {
  id: string;
  email: string;
  displayName: string;
}

export type WorkspaceAccessRole = WorkspaceRole;

export interface DatabaseWorkspaceMember extends EditorSessionUser {
  role: WorkspaceAccessRole;
}
