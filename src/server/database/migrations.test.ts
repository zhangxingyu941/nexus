import { newDb } from "pg-mem";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "./migrations";

describe("authentication database migration", () => {
  let pool: Pool;

  beforeEach(() => {
    const memoryDatabase = newDb({ autoCreateForeignKeyIndices: true });
    const adapter = memoryDatabase.adapters.createPg();
    pool = new adapter.Pool() as Pool;
  });

  afterEach(async () => {
    await pool.end();
  });

  it("adds nullable credentials to users and preserves legacy identities", async () => {
    await migrateDatabase(pool);
    await pool.query(
      "INSERT INTO app_users (id, email, display_name, created_at) VALUES ($1, $2, $3, $4)",
      ["legacy-user", "legacy@example.com", "Legacy User", 1000],
    );

    const result = await pool.query(
      `SELECT id, password_hash, email_verified_at, updated_at
       FROM app_users
       WHERE id = $1`,
      ["legacy-user"],
    );

    expect(result.rows).toEqual([{
      email_verified_at: null,
      id: "legacy-user",
      password_hash: null,
      updated_at: null,
    }]);
  });

  it("creates OAuth, one-time token, and audit tables under one recorded migration", async () => {
    await migrateDatabase(pool);

    const tables = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('oauth_accounts', 'auth_tokens', 'auth_audit_events')
       ORDER BY table_name`,
    );
    const migration = await pool.query(
      "SELECT COUNT(*)::int AS count FROM schema_migrations WHERE id = $1",
      ["2026-07-13-production-authentication"],
    );

    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "auth_audit_events",
      "auth_tokens",
      "oauth_accounts",
    ]);
    expect(Number(migration.rows[0].count)).toBe(1);
  });

  it("enforces provider account uniqueness", async () => {
    await migrateDatabase(pool);
    await pool.query(
      "INSERT INTO app_users (id, email, display_name, created_at) VALUES ($1, $2, $3, $4)",
      ["user-1", "first@example.com", "First", 1000],
    );
    await pool.query(
      "INSERT INTO app_users (id, email, display_name, created_at) VALUES ($1, $2, $3, $4)",
      ["user-2", "second@example.com", "Second", 1000],
    );
    await pool.query(
      `INSERT INTO oauth_accounts
       (provider, provider_account_id, user_id, provider_email, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      ["github", "github-42", "user-1", "first@example.com", 1000],
    );

    await expect(pool.query(
      `INSERT INTO oauth_accounts
       (provider, provider_account_id, user_id, provider_email, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      ["github", "github-42", "user-2", "second@example.com", 1000],
    )).rejects.toThrow();
  });

  it("creates workspace-scoped Yjs snapshot and ordered update tables", async () => {
    await migrateDatabase(pool);

    const tables = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('yjs_room_snapshots', 'yjs_room_updates')
       ORDER BY table_name`,
    );
    const migration = await pool.query(
      "SELECT COUNT(*)::int AS count FROM schema_migrations WHERE id = $1",
      ["2026-07-13-yjs-persistence"],
    );

    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "yjs_room_snapshots",
      "yjs_room_updates",
    ]);
    expect(Number(migration.rows[0].count)).toBe(1);
  });
});
