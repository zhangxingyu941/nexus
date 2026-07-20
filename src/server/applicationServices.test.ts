import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { createPostgresServices } from "./applicationServices";
import { DocumentAuthorizationService } from "./documentAuthorization";
import { PostgresDocumentStore } from "./postgresDocumentStore";

describe("application services", () => {
  it("reuses the workspace invitation limiter across service construction", () => {
    const pool = {} as Pool;

    const first = createPostgresServices(pool).workspaceInviteLimiter;
    const second = createPostgresServices(pool).workspaceInviteLimiter;

    expect(second).toBe(first);
  });

  it("exposes one document authorization service for every request service graph", () => {
    const services = createPostgresServices({} as Pool);

    expect(services.documentAuthorization).toBeInstanceOf(DocumentAuthorizationService);
    expect(services.documentStore).toBeInstanceOf(PostgresDocumentStore);
  });
});
