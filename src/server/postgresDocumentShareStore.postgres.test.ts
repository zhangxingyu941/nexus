import type { Pool, PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPostgresIntegrationContext } from "../test/postgresIntegration";
import {
  DocumentAuthorizationService,
  PostgresDocumentAuthorizationRecords,
} from "./documentAuthorization";
import { DocumentShareTokenService } from "./documentShareTokens";
import type { ObjectStorage } from "./objectStorage";
import { PostgresAttachmentStore } from "./postgresAttachmentStore";
import {
  DocumentShareGoneError,
  PostgresDocumentShareStore,
} from "./postgresDocumentShareStore";

const describeWithPostgres = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const TEST_SECRET = "postgres-document-share-secret-at-least-32-bytes";

describeWithPostgres("PostgresDocumentShareStore concurrency", () => {
  let close: () => Promise<void>;
  let pool: Pool;

  beforeEach(async () => {
    const context = await createPostgresIntegrationContext();
    close = context.close;
    pool = context.pool;
    await seedDocument(pool);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await close();
  });

  it("serializes concurrent regeneration to one active link", async () => {
    const tokenService = new DocumentShareTokenService(TEST_SECRET, () => 10_000);
    const rawTokens = ["concurrent-token-1", "concurrent-token-2"];
    vi.spyOn(tokenService, "createRawToken").mockImplementation(() => rawTokens.shift()!);
    let shareSequence = 0;
    let auditSequence = 0;
    const firstClient = await pool.connect();
    const secondClient = await pool.connect();
    const queuedClients = [firstClient, secondClient];
    const storePool = {
      connect: async () => queuedClients.shift() ?? pool.connect(),
      query: pool.query.bind(pool),
    } as Pool;
    const store = new PostgresDocumentShareStore(storePool, {
      appUrl: "http://localhost:3000",
      attachmentStore: new PostgresAttachmentStore(pool),
      auditEventIdFactory: () => `share-audit-${++auditSequence}`,
      authorization: new DocumentAuthorizationService(
        new PostgresDocumentAuthorizationRecords(pool),
      ),
      idFactory: () => `share-${++shareSequence}`,
      now: () => 10_000,
      objectStorage: emptyObjectStorage(),
      tokenService,
    });

    const blocker = await pool.connect();
    const firstPid = await loadBackendPid(firstClient);
    const secondPid = await loadBackendPid(secondClient);
    let first: Promise<ReturnType<typeof store.replaceManagedLink> extends Promise<infer T> ? T : never>;
    let second: typeof first;
    let blockerReleased = false;
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        `SELECT id
         FROM editor_documents
         WHERE workspace_id = 'workspace-1' AND id = 'document-1'
         FOR UPDATE`,
      );
      first = store.replaceManagedLink("owner-1", "public-document-1", 100_000);
      second = store.replaceManagedLink("owner-1", "public-document-1", 200_000);
      await Promise.all([
        waitForLock(pool, firstPid),
        waitForLock(pool, secondPid),
      ]);
      await blocker.query("COMMIT");
      blockerReleased = true;
    } finally {
      if (!blockerReleased) await blocker.query("ROLLBACK");
      blocker.release();
    }
    const created = await Promise.all([first!, second!]);
    const active = await pool.query(
      `SELECT id
       FROM document_share_links
       WHERE workspace_id = 'workspace-1'
         AND document_id = 'document-1'
         AND revoked_at IS NULL`,
    );

    expect(active.rows).toHaveLength(1);
    expect(created.map((link) => link.id)).toContain(String(active.rows[0].id));
    const activeLink = created.find((link) => link.id === String(active.rows[0].id))!;
    const revokedLink = created.find((link) => link.id !== String(active.rows[0].id))!;
    await expect(store.loadSharedDocument(tokenFromUrl(activeLink.url)))
      .resolves.toMatchObject({ document: { title: "Shared document" } });
    await expect(store.loadSharedDocument(tokenFromUrl(revokedLink.url)))
      .rejects.toBeInstanceOf(DocumentShareGoneError);
  });
});

async function loadBackendPid(client: PoolClient) {
  const result = await client.query("SELECT pg_backend_pid() AS pid");
  return Number(result.rows[0].pid);
}

async function waitForLock(pool: Pool, pid: number) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT wait_event_type
       FROM pg_stat_activity
       WHERE pid = $1`,
      [pid],
    );
    if (result.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Backend ${pid} did not reach the share regeneration lock`);
}

function emptyObjectStorage(): ObjectStorage {
  return {
    deletePrefix: async () => undefined,
    getObject: async () => {
      throw new Error("missing");
    },
    putObject: async () => undefined,
  };
}

function tokenFromUrl(url: string) {
  return new URL(url).pathname.split("/").at(-1)!;
}

async function seedDocument(pool: Pool) {
  await pool.query(
    `INSERT INTO app_users (id, email, display_name, created_at)
     VALUES ('owner-1', 'owner@example.com', 'Owner', 1000)`,
  );
  await pool.query(
    `INSERT INTO editor_workspaces (id, name, updated_at, created_at)
     VALUES ('workspace-1', 'Workspace', 1000, 1000)`,
  );
  await pool.query(
    `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
     VALUES ('workspace-1', 'owner-1', 'owner', 1000)`,
  );
  await pool.query(
    `INSERT INTO editor_documents
       (workspace_id, id, public_id, created_by, access_mode, title, position, updated_at)
     VALUES
       ('workspace-1', 'document-1', 'public-document-1', 'owner-1',
        'private', 'Shared document', 0, 1000)`,
  );
}
