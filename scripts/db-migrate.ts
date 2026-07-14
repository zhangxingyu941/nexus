import "dotenv/config";
import { migrateDatabase } from "../src/server/database/migrations";
import { createDatabasePool } from "../src/server/database/pool";

const pool = createDatabasePool();

try {
  await migrateDatabase(pool);
  console.log("PostgreSQL schema migration completed.");
} finally {
  await pool.end();
}
