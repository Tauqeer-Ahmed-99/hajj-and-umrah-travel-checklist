import type { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export async function migrate(pool: Pool) {
  const directory = fileURLToPath(new URL("../db/", import.meta.url));
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(20413002)");
    await connection.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const applied = await connection.query<{ name: string }>(
      "SELECT name FROM schema_migrations",
    );
    const names = new Set(applied.rows.map((row) => row.name));
    for (const name of (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      if (names.has(name)) continue;
      await connection.query(await readFile(resolve(directory, name), "utf8"));
      await connection.query(
        "INSERT INTO schema_migrations (name) VALUES ($1)",
        [name],
      );
    }
    await connection.query("COMMIT");
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}
