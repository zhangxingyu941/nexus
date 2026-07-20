import type { WorkspaceTransitionResponse } from "../../../shared/workspaceApi";
import type {
  DeletedWorkspaceSummary,
  WorkspaceDeletionSummary,
} from "../../../shared/workspaceLifecycle";
import { jsonRequest, requestJson } from "./apiClient";

export interface WorkspaceDeletionTransitionResponse extends WorkspaceTransitionResponse {
  deletedWorkspace: DeletedWorkspaceSummary;
}

export interface WorkspaceLifecycleRepository {
  summary(workspaceId: string): Promise<WorkspaceDeletionSummary>;
  delete(workspaceId: string, confirmationName: string): Promise<WorkspaceDeletionTransitionResponse>;
  listTrash(): Promise<DeletedWorkspaceSummary[]>;
  restore(workspaceId: string): Promise<WorkspaceTransitionResponse>;
}

export const workspaceLifecycleRepository: WorkspaceLifecycleRepository = {
  summary: (workspaceId) => requestJson<{ summary: WorkspaceDeletionSummary }>(
    `${workspacePath(workspaceId)}/deletion-summary`,
    jsonRequest("GET"),
  ).then((payload) => payload.summary),
  delete: (workspaceId, confirmationName) => requestJson<WorkspaceDeletionTransitionResponse>(
    workspacePath(workspaceId),
    jsonRequest("DELETE", { confirmationName }),
  ),
  listTrash: () => requestJson<{ workspaces: DeletedWorkspaceSummary[] }>(
    "/api/workspaces/trash",
    jsonRequest("GET"),
  ).then((payload) => payload.workspaces),
  restore: (workspaceId) => requestJson<WorkspaceTransitionResponse>(
    `${workspacePath(workspaceId)}/restore`,
    jsonRequest("POST"),
  ),
};

function workspacePath(workspaceId: string) {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}`;
}
