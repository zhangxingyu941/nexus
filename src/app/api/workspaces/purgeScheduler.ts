import { after } from "next/server";

type PurgeSchedule = (work: () => Promise<void>) => void;

export function scheduleWorkspacePurge(
  purge: () => Promise<void>,
  schedule: PurgeSchedule = after,
) {
  schedule(async () => {
    await purge().catch(() => undefined);
  });
}
