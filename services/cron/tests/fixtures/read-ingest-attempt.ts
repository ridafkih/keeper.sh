import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { and, eq } from "drizzle-orm";
import { calendarsTable } from "@keeper.sh/database/schema";

const databaseUrl = process.env.DATABASE_URL;
const calendarId = process.env.CALENDAR_ID;

if (!databaseUrl || !calendarId) {
  throw new Error("DATABASE_URL and CALENDAR_ID are required");
}

const client = new SQL(databaseUrl);
const database = drizzle(client);

const [attempt] = await database
  .select({
    failureCount: calendarsTable.ingestFailureCount,
    nextAttemptAt: calendarsTable.ingestNextAttemptAt,
  })
  .from(calendarsTable)
  .where(eq(calendarsTable.id, calendarId))
  .limit(1);

if (!attempt) {
  throw new Error("Calendar not found");
}

const compareAndSwapped = await database
  .update(calendarsTable)
  .set({ ingestFailureCount: attempt.failureCount + 1 })
  .where(and(
    eq(calendarsTable.id, calendarId),
    eq(calendarsTable.ingestFailureCount, attempt.failureCount),
    eq(calendarsTable.ingestNextAttemptAt, attempt.nextAttemptAt as Date),
  ))
  .returning({ id: calendarsTable.id });

await client.end();

process.stdout.write(JSON.stringify({
  compareAndSwappedRows: compareAndSwapped.length,
  nextAttemptAt: attempt.nextAttemptAt?.toISOString() ?? null,
  timeZone: process.env.TZ ?? null,
}));
