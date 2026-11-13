import { Pool } from "pg";

let pool: Pool | undefined;
export function database() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString)
      throw new Error("DATABASE_URL is required by the API.");
    pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", () =>
      console.error("An idle database connection was lost."),
    );
  }
  return pool;
}
