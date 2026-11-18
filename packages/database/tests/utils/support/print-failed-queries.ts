import { sql } from "drizzle-orm";
import { closeDatabase, createDatabase } from "../../../src/utils/database";

const [mode] = process.argv.slice(2);
const email = process.env.PROBE_EMAIL ?? "";
const token = process.env.PROBE_TOKEN ?? "";

const jobRunnerLogger: Pick<Console, "error" | "warn"> = globalThis.console;

const database = await createDatabase(process.env.KEEPER_TEST_DATABASE_URL ?? "", {
  maxConnections: 1,
  statementTimeoutMs: 200,
});

await database.execute(sql`
  create temp table printed_accounts (
    id int primary key,
    email text unique not null,
    seats int check (seats > 0)
  )
`);
await database.execute(sql`insert into printed_accounts values (${1}, ${email}, ${1})`);

const failures: Record<string, () => PromiseLike<unknown>> = {
  "bad-sql": () => database.execute(sql`selec ${token}`),
  "check": () => database.execute(sql`insert into printed_accounts values (${2}, ${token}, ${0})`),
  "invalid-input": () => database.execute(sql`select ${token}::int`),
  "not-null": () => database.execute(sql`insert into printed_accounts (id, seats) values (${3}, ${token.length})`),
  "statement-timeout": () => database.execute(sql`select pg_sleep(2), ${token}::text`),
  "unique": () => database.execute(sql`insert into printed_accounts values (${4}, ${email}, ${1})`),
};

if (mode === "reported") {
  for (const [name, fail] of Object.entries(failures)) {
    try {
      await fail();
    } catch (error) {
      jobRunnerLogger.warn(`Cron job '${name}' failed:`, error);
      jobRunnerLogger.error(error);
    }
  }
  closeDatabase(database);
} else {
  const fail = failures[mode ?? ""];
  if (!fail) {
    throw new Error("unknown mode");
  }
  await fail();
}
