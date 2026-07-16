import type { WorkspaceSummary } from "../../../shared/workspace";
import { jsonRequest, requestJson } from "./apiClient";
import type { WorkspaceRepository } from "./workspaceRepository";

export function createRemoteWorkspaceRepository(): WorkspaceRepository {
  return {
    target: "remote",
    list: () => requestJson("/api/workspaces", jsonRequest("GET")),
    load: (workspaceId) => requestJson(
      `/api/workspaces/${encodeURIComponent(workspaceId)}`,
      jsonRequest("GET"),
    ),
    create: (name) => requestJson("/api/workspaces", jsonRequest("POST", { name })),
    rename: (workspaceId, name) => requestJson<{ workspace: WorkspaceSummary }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}`,
      jsonRequest("PATCH", { name }),
    ).then((payload) => payload.workspace),
    select: (workspaceId) => requestJson(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/select`,
      jsonRequest("POST"),
    ),
    save: (workspaceId, content) => requestJson(
      `/api/workspaces/${encodeURIComponent(workspaceId)}`,
      jsonRequest("PUT", { content }),
    ).then(() => undefined),
  };
}
