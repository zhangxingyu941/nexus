import type { WorkspaceRole } from "./workspace";

export interface WorkspaceMemberSummary {
  id: string;
  email: string;
  displayName: string;
  role: WorkspaceRole;
  joinedAt: number;
}
