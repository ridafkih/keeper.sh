import { SYNC_TTL_SECONDS } from "@keeper.sh/constants";
import { sql } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const MAPPING_SYNC_STATE_EVENT = "sync:mappings";
const MAPPING_SYNC_STATE_SEQUENCE_KEY_PREFIX = "sync:mappings:seq:";

interface MappingSyncSummary {
  failingCount: number;
  pendingCount: number;
}

interface MappingSyncState extends MappingSyncSummary {
  seq: number;
}

type MappingSyncStateDatabase = Pick<BunSQLDatabase, "execute">;

interface MappingSyncStateRedis {
  expire: (key: string, seconds: number) => Promise<unknown>;
  incr: (key: string) => Promise<number>;
}

interface MappingSyncStateConfig {
  broadcast: (userId: string, eventName: string, data: MappingSyncState) => void;
  database: MappingSyncStateDatabase;
  redis: MappingSyncStateRedis;
}

interface MappingSyncStateSummaryRow {
  failingCount: number | string;
  pendingCount: number | string;
}

const readMappingSyncSummary = async (
  database: MappingSyncStateDatabase,
  userId: string,
): Promise<MappingSyncSummary> => {
  const result = await database.execute(sql`
    WITH "active_mappings" AS (
      SELECT
        mapping."firstSyncedAt",
        (
          coalesce(source_account."needsReauthentication", false)
          OR coalesce(destination_account."needsReauthentication", false)
          OR source."unavailableSince" IS NOT NULL
          OR coalesce(schedule."failureCount", 0) > 0
          OR coalesce(schedule."parkedReason" IN ('credential-rejected', 'unresolvable'), false)
          OR destination."failureCount" > 0
        ) AS "failing"
      FROM "source_destination_mappings" AS mapping
      INNER JOIN "calendars" AS source ON source."id" = mapping."sourceCalendarId"
      INNER JOIN "calendars" AS destination ON destination."id" = mapping."destinationCalendarId"
      LEFT JOIN "calendar_accounts" AS source_account ON source_account."id" = source."accountId"
      LEFT JOIN "calendar_accounts" AS destination_account
        ON destination_account."id" = destination."accountId"
      LEFT JOIN "source_ingest_schedule" AS schedule ON schedule."calendarId" = source."id"
      WHERE source."userId" = ${userId}
        AND source."disabled" = false
        AND destination."disabled" = false
        AND 'push' = ANY(destination."capabilities")
    )
    SELECT
      count(*) FILTER (WHERE "failing") AS "failingCount",
      count(*) FILTER (WHERE NOT "failing" AND "firstSyncedAt" IS NULL) AS "pendingCount"
    FROM "active_mappings"
  `);
  const [row] = result as unknown as MappingSyncStateSummaryRow[];
  return {
    failingCount: Number(row?.failingCount ?? 0),
    pendingCount: Number(row?.pendingCount ?? 0),
  };
};

const createMappingSyncStateReader = (
  config: Pick<MappingSyncStateConfig, "database" | "redis">,
) => async (userId: string): Promise<MappingSyncState> => {
  const sequenceKey = `${MAPPING_SYNC_STATE_SEQUENCE_KEY_PREFIX}${userId}`;
  const seq = await config.redis.incr(sequenceKey);
  await config.redis.expire(sequenceKey, SYNC_TTL_SECONDS);
  return { ...await readMappingSyncSummary(config.database, userId), seq };
};

const createMappingSyncStatePublisher = (config: MappingSyncStateConfig) => {
  const readMappingSyncState = createMappingSyncStateReader(config);
  return async (userId: string): Promise<void> => {
    config.broadcast(userId, MAPPING_SYNC_STATE_EVENT, await readMappingSyncState(userId));
  };
};

export {
  MAPPING_SYNC_STATE_EVENT,
  createMappingSyncStatePublisher,
  createMappingSyncStateReader,
  readMappingSyncSummary,
};
export type { MappingSyncState, MappingSyncStateConfig, MappingSyncSummary };
