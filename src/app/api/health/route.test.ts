import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("Next health route", () => {
  it("returns backend health information", async () => {
    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "nexus",
    });
    expect(response.status).toBe(200);
  });
});
