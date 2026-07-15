import type { EditorWorkspace } from "../features/editor/model/block";

export const WORKSPACE_NAME_MAX_LENGTH = 80;

export type WorkspaceRole = "owner" | "editor" | "viewer";

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceCatalog {
  currentWorkspaceId: string;
  workspaces: WorkspaceSummary[];
}

export interface WorkspaceSnapshot {
  summary: WorkspaceSummary;
  content: EditorWorkspace;
}

export class WorkspaceNameValidationError extends Error {
  constructor() {
    super("工作区名称长度必须为 1-80 个字符");
    this.name = "WorkspaceNameValidationError";
  }
}

export function normalizeWorkspaceName(input: unknown) {
  const name = typeof input === "string" ? input.trim() : "";
  if (!name || name.length > WORKSPACE_NAME_MAX_LENGTH) {
    throw new WorkspaceNameValidationError();
  }
  return name;
}

export function sortWorkspaceSummaries(items: WorkspaceSummary[], currentWorkspaceId: string) {
  return [...items].sort((left, right) => {
    const leftIsCurrent = left.id === currentWorkspaceId;
    const rightIsCurrent = right.id === currentWorkspaceId;
    if (leftIsCurrent !== rightIsCurrent) return leftIsCurrent ? -1 : 1;
    if (leftIsCurrent) return 0;

    const createdAtComparison = left.createdAt - right.createdAt;
    if (createdAtComparison !== 0) return createdAtComparison;

    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}
