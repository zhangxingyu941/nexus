import { describe, expect, it, vi } from "vitest";
import { RedisSessionCache } from "./redisSessionCache";

describe("RedisSessionCache", () => {
  it("connects lazily and stores namespaced session entries with a TTL", async () => {
    const client = {
      connect: vi.fn().mockImplementation(async function (this: { isOpen: boolean }) {
        this.isOpen = true;
      }),
      del: vi.fn().mockResolvedValue(1),
      get: vi.fn().mockResolvedValue(JSON.stringify({
        displayName: "林夏",
        email: "linxia@example.com",
        id: "user-1",
      })),
      isOpen: false,
      set: vi.fn().mockResolvedValue("OK"),
    };
    const cache = new RedisSessionCache(client);

    await expect(cache.get("token-hash")).resolves.toEqual({
      displayName: "林夏",
      email: "linxia@example.com",
      id: "user-1",
    });
    await cache.set("token-hash", { displayName: "林夏", email: "linxia@example.com", id: "user-1" }, 5000);
    await cache.delete("token-hash");

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledWith("notion-editor:session:token-hash");
    expect(client.set).toHaveBeenCalledWith(
      "notion-editor:session:token-hash",
      JSON.stringify({ displayName: "林夏", email: "linxia@example.com", id: "user-1" }),
      { PX: 5000 },
    );
    expect(client.del).toHaveBeenCalledWith("notion-editor:session:token-hash");
  });

  it("ignores malformed cached users", async () => {
    const client = {
      connect: vi.fn(),
      del: vi.fn(),
      get: vi.fn().mockResolvedValue('{"id":1}'),
      isOpen: true,
      set: vi.fn(),
    };

    await expect(new RedisSessionCache(client).get("token-hash")).resolves.toBeNull();
  });
});
