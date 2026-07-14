// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { checkServiceHealth } from "./healthcheck";

describe("service healthcheck", () => {
  it("accepts a successful HTTP response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await expect(checkServiceHealth("http://localhost:3000/api/health", {
      fetchImpl,
      timeoutMs: 1000,
    })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:3000/api/health",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects unhealthy responses with a stable message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));

    await expect(checkServiceHealth("http://localhost:3000/api/health", {
      fetchImpl,
      timeoutMs: 1000,
    })).rejects.toThrow("Healthcheck failed with HTTP 503");
  });

  it("aborts checks that exceed the configured timeout", async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));

    await expect(checkServiceHealth("http://localhost:3000/api/health", {
      fetchImpl,
      timeoutMs: 1,
    })).rejects.toThrow("Healthcheck timed out after 1ms");
  });
});
