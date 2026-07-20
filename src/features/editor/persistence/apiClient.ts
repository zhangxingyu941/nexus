import type { ApiErrorPayload } from "../../../shared/workspaceApi";

const INVALID_JSON = Symbol("invalid-json");

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryAfterSeconds?: number,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiRequestError("工作区服务请求失败", "service_unavailable");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json().catch(() => INVALID_JSON) as unknown;

  if (payload === INVALID_JSON && response.ok) {
    throw new ApiRequestError("工作区服务返回无效响应", "service_unavailable");
  }

  if (!response.ok) {
    const error = isApiError(payload)
      ? payload
      : isLegacyErrorPayload(payload)
        ? { code: "service_unavailable", error: payload.error }
      : { code: "service_unavailable", error: "工作区服务请求失败" };
    throw new ApiRequestError(error.error, error.code, error.retryAfterSeconds, response.status);
  }

  return payload as T;
}

export function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    method,
  };
}

function isApiError(value: unknown): value is ApiErrorPayload {
  return typeof value === "object"
    && value !== null
    && typeof (value as ApiErrorPayload).code === "string"
    && typeof (value as ApiErrorPayload).error === "string"
    && ((value as ApiErrorPayload).retryAfterSeconds === undefined
      || typeof (value as ApiErrorPayload).retryAfterSeconds === "number");
}

function isLegacyErrorPayload(value: unknown): value is { error: string } {
  return typeof value === "object"
    && value !== null
    && !("code" in value)
    && typeof (value as { error: unknown }).error === "string";
}
