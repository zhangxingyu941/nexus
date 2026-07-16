import type { WorkspaceSummary } from "../../../shared/workspace";
import type { WorkspaceRepository } from "./workspaceRepository";

export function createRemoteWorkspaceRepository(): WorkspaceRepository {
  return {
    target: "remote",
    list: () => requestJson("/api/workspaces", { headers: jsonHeaders(), method: "GET" }),
    load: (workspaceId) => requestJson(
      `/api/workspaces/${encodeURIComponent(workspaceId)}`,
      { headers: jsonHeaders(), method: "GET" },
    ),
    create: (name) => requestJson("/api/workspaces", jsonRequest("POST", { name })),
    rename: (workspaceId, name) => requestJson<{ workspace: WorkspaceSummary }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}`,
      jsonRequest("PATCH", { name }),
    ).then((payload) => payload.workspace),
    select: (workspaceId) => requestJson(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/select`,
      { headers: jsonHeaders(), method: "POST" },
    ),
    save: (workspaceId, content) => requestJson(
      `/api/workspaces/${encodeURIComponent(workspaceId)}`,
      jsonRequest("PUT", { content }),
    ).then(() => undefined),
  };
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new Error("工作区服务返回无效响应");
  }

  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload
      ? (payload as { error: unknown }).error
      : undefined;
    throw new Error(typeof error === "string" && error ? error : "工作区服务请求失败");
  }

  return payload as T;
}

function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: jsonHeaders(true),
    method,
  };
}

function jsonHeaders(hasBody = false) {
  return {
    Accept: "application/json",
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
  };
}
