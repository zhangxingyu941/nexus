import { describe, expect, it, vi } from "vitest";
import { scheduleWorkspacePurge } from "./purgeScheduler";

describe("scheduleWorkspacePurge", () => {
  it("runs the purge after the response and swallows background failures", async () => {
    let scheduledWork: (() => Promise<void>) | undefined;
    const schedule = vi.fn((work: () => Promise<void>) => {
      scheduledWork = work;
    });
    const purge = vi.fn().mockRejectedValue(new Error("storage down"));

    scheduleWorkspacePurge(purge, schedule);

    expect(schedule).toHaveBeenCalledOnce();
    await expect(scheduledWork!()).resolves.toBeUndefined();
    expect(purge).toHaveBeenCalledOnce();
  });
});
