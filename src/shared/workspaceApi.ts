import type { WorkspaceCatalog, WorkspaceSnapshot } from "./workspace";

export interface ApiErrorPayload {
  code: string;
  error: string;
  retryAfterSeconds?: number;
}

export interface WorkspaceTransitionResponse {
  catalog: WorkspaceCatalog;
  workspace: WorkspaceSnapshot;
}
