export interface EditorSessionUser {
  id: string;
  email: string;
  displayName: string;
}

export type WorkspaceAccessRole = "owner" | "editor" | "viewer";

export interface DatabaseWorkspaceMember extends EditorSessionUser {
  role: WorkspaceAccessRole;
}
