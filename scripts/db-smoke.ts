import "dotenv/config";
import { createDatabasePool } from "../src/server/database/pool";

const pool = createDatabasePool();

try {
  const database = await pool.query("SELECT current_database() AS name");
  const tables = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('app_users', 'editor_workspaces', 'editor_documents', 'editor_blocks')`,
  );
  const tableCount = Number(tables.rows[0].count);

  if (tableCount !== 4) {
    throw new Error("数据库可连接，但 M4 schema 尚未完整迁移");
  }

  console.log(`PostgreSQL smoke check passed for ${database.rows[0].name}.`);
} finally {
  await pool.end();
}
