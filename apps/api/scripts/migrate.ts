import { database } from "../src/database";
import { migrate } from "./migrations";

const pool = database();
try {
  await migrate(pool);
  console.log("Database migrations applied.");
} finally {
  await pool.end();
}
