import { sql } from "drizzle-orm";
import type { Database } from "../src/database";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export async function migrate(db: Database) {
  const directory = fileURLToPath(new URL("../db/", import.meta.url));
  await db.transaction(async (connection) => {
    await connection.execute(sql`SELECT pg_advisory_xact_lock(20413002)`);
    await connection.execute(
      sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const applied = await connection.execute<{ name: string }>(
      sql`SELECT name FROM schema_migrations`,
    );
    const names = new Set(applied.rows.map((row) => row.name));
    for (const name of (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      if (names.has(name)) continue;
      await connection.execute(
        sql.raw(await readFile(resolve(directory, name), "utf8")),
      );
      await connection.execute(
        sql`INSERT INTO schema_migrations (name) VALUES (${name})`,
      );
    }
  });
}
