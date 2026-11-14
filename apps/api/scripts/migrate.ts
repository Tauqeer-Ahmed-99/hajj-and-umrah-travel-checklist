import { database } from "../src/database";
import { migrate } from "./migrations";

const db = database();
try {
  await migrate(db);
  console.log("Database migrations applied.");
} finally {
  await db.$client.end();
}
