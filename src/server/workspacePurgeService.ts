import type { ObjectStorage } from "./objectStorage";
import type {
  ExpiredWorkspacePurgeCandidate,
  WorkspacePurgeClaim,
} from "./postgresWorkspaceLifecycleStore";

const MAX_PURGE_CANDIDATES = 3;

interface WorkspacePurgeLifecycleStore {
  claimExpiredWorkspace: (workspaceId: string) => Promise<WorkspacePurgeClaim | null>;
  listExpiredPurgeCandidates: (limit: number) => Promise<ExpiredWorkspacePurgeCandidate[]>;
}

interface WorkspacePurgeLogger {
  error: (event: string, details: Record<string, string>) => void;
}

interface WorkspacePurgeServiceOptions {
  lifecycleStore: WorkspacePurgeLifecycleStore;
  logger?: WorkspacePurgeLogger;
  objectStorage: Pick<ObjectStorage, "deletePrefix">;
}

export class WorkspacePurgeService {
  private readonly logger: WorkspacePurgeLogger;

  constructor(private readonly options: WorkspacePurgeServiceOptions) {
    this.logger = options.logger ?? console;
  }

  async purgeExpired(limit = MAX_PURGE_CANDIDATES): Promise<void> {
    const candidates = await this.options.lifecycleStore.listExpiredPurgeCandidates(
      Math.min(Math.max(limit, 0), MAX_PURGE_CANDIDATES),
    );

    for (const candidate of candidates) {
      const claim = await this.options.lifecycleStore.claimExpiredWorkspace(candidate.id);
      if (!claim) continue;

      let phase = "objects";
      try {
        await this.options.objectStorage.deletePrefix(`${claim.candidate.id}/`);
        phase = "database";
        const deleted = await claim.purgeDatabaseRow();
        if (!deleted) {
          this.logFailure(claim.candidate.id, "database", "workspace is no longer expired");
        }
      } catch (error) {
        this.logFailure(
          claim.candidate.id,
          phase,
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        await claim.release();
      }
    }
  }

  private logFailure(workspaceId: string, phase: string, error: string) {
    this.logger.error("workspace_purge_failed", { error, phase, workspaceId });
  }
}
