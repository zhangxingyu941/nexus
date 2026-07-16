import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createPostgresServices } from "./applicationServices";

describe("application services", () => {
  it("reuses the workspace invitation limiter across service construction", () => {
    const pool = {} as Pool;

    const first = createPostgresServices(pool).workspaceInviteLimiter;
    const second = createPostgresServices(pool).workspaceInviteLimiter;

    expect(second).toBe(first);
  });
});
