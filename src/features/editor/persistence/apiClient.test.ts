import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, requestJson } from "./apiClient";

describe("apiClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves stable error fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      code: "invite_rate_limited",
      error: "邀请发送过于频繁",
      retryAfterSeconds: 60,
    }, 429)));

    await expect(requestJson("/api/test", { method: "POST" })).rejects.toMatchObject({
      code: "invite_rate_limited",
      message: "邀请发送过于频繁",
      retryAfterSeconds: 60,
    });
  });

  it("returns typed JSON payloads for successful responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ id: "workspace-1" })));

    await expect(requestJson<{ id: string }>("/api/test", { method: "GET" }))
      .resolves.toEqual({ id: "workspace-1" });
  });

  it.each([
    ["malformed JSON", new Response("not-json", { status: 503 })],
    ["a non-contract error payload", jsonResponse({ message: "unknown failure" }, 503)],
  ])("uses a stable fallback for %s", async (_label, response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(requestJson("/api/test", { method: "GET" })).rejects.toMatchObject({
      code: "service_unavailable",
      message: "工作区服务请求失败",
    });
  });

  it("preserves legacy workspace error messages with a stable fallback code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: "工作区不存在",
    }, 404)));

    await expect(requestJson("/api/workspaces/missing", { method: "GET" })).rejects.toMatchObject({
      code: "service_unavailable",
      message: "工作区不存在",
    });
  });

  it("creates JSON requests with only the necessary headers", () => {
    expect(jsonRequest("GET")).toEqual({
      headers: { Accept: "application/json" },
      method: "GET",
    });
    expect(jsonRequest("POST", { name: "产品团队" })).toEqual({
      body: JSON.stringify({ name: "产品团队" }),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  });
});

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}
