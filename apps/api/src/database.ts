import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { DrizzleQueryError } from "drizzle-orm";

export type Database = NodePgDatabase<typeof schema>;
export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
export type DatabaseExecutor = Pick<Database, "execute">;

export function isUniqueViolation(error: unknown) {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "23505"
  );
}

let client: (Database & { $client: Pool }) | undefined;
export function database() {
  if (!client) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString)
      throw new Error("DATABASE_URL is required by the API.");
    const pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", () =>
      console.error("An idle database connection was lost."),
    );
    client = drizzle({ client: pool, schema });
  }
  return client;
}
