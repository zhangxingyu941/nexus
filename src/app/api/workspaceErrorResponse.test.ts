import { describe, expect, it } from "vitest";
import { WorkspaceDomainError } from "../../server/workspaceErrors";
import { workspaceErrorResponse } from "./workspaceErrorResponse";

describe("workspaceErrorResponse", () => {
  it("maps an expired invitation to a gone response", async () => {
    const response = workspaceErrorResponse(
      new WorkspaceDomainError("invite_expired", "Invitation has expired"),
    );

    expect(response?.status).toBe(410);
    await expect(response?.json()).resolves.toEqual({
      code: "invite_expired",
      error: "Invitation has expired",
    });
  });

  it("preserves an optional retry delay for domain errors", async () => {
    const response = workspaceErrorResponse(
      new WorkspaceDomainError("invite_rate_limited", "Please wait"),
      60,
    );

    expect(response?.status).toBe(429);
    await expect(response?.json()).resolves.toEqual({
      code: "invite_rate_limited",
      error: "Please wait",
      retryAfterSeconds: 60,
    });
  });

  it("returns null for non-domain errors", () => {
    expect(workspaceErrorResponse(new Error("internal detail"))).toBeNull();
  });
});
