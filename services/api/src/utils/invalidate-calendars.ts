import { calendarsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type Redis from "ioredis";

const INVALIDATION_PREFIX = "sync:invalidated:";
const INVALIDATION_TTL_SECONDS = 300;

const invalidateCalendarsForAccount = async (
  database: BunSQLDatabase,
  redis: Redis,
  accountId: string,
): Promise<void> => {
  const calendars = await database
    .select({ id: calendarsTable.id })
    .from(calendarsTable)
    .where(eq(calendarsTable.accountId, accountId));

  if (calendars.length === 0) {
    return;
  }

  const pipeline = redis.pipeline();
  for (const calendar of calendars) {
    const key = `${INVALIDATION_PREFIX}${calendar.id}`;
    pipeline.set(key, "1", "EX", INVALIDATION_TTL_SECONDS);
  }
  await pipeline.exec();
};

export { invalidateCalendarsForAccount };
