import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const DB_STATEMENT_TIMEOUT_MS = 15_000;

const client = postgres(process.env.DATABASE_URL!, {
  ssl: process.env.NODE_ENV === "production" ? "require" : false,
  // Fail fast if Postgres is unreachable rather than hanging the request
  connect_timeout: 10,
  // Release idle connections so a deployment gap doesn't leave stale sockets
  idle_timeout: 20,
  // Recycle connections every 30 min to avoid server-side max_lifetime resets
  max_lifetime: 1800,
  connection: {
    application_name: "ceo-dashboard",
    statement_timeout: DB_STATEMENT_TIMEOUT_MS,
    lock_timeout: 5_000,
    idle_in_transaction_session_timeout: DB_STATEMENT_TIMEOUT_MS,
  },
});

export const db = drizzle(client, { schema });
