import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { migrateDatabase } from "../server/database/migrations";

export async function createPostgresIntegrationContext() {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const schema = `test_${randomUUID().replace(/-/g, "")}`;
  const admin = new Pool({ connectionString });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new Pool({
    connectionString,
    options: `-c search_path=${schema}`,
  });
  await migrateDatabase(pool);

  return {
    pool,
    async close() {
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
