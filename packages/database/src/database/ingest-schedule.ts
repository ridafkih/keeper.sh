import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

type IngestScheduleDatabase = Pick<BunSQLDatabase, "execute">;

type IngestScheduleLane = "fleet" | "wake";

type IngestScheduleParkedReason = "credential-rejected" | "ineligible" | "unresolvable";

interface ClaimIngestsInput {
  lane: IngestScheduleLane;
  leaseMs: number;
  leaseToken: string;
  limit: number;
}

interface ClaimedIngest {
  calendarId: string;
  claimedDueAt: Date | null;
  failureCount: number;
  lagMs: number;
  leaseToken: string;
  releaseSeq: number;
  userId: string;
  wakeCorrelationId: string | null;
  wakeDueAt: Date | null;
  wakeReceivedAt: Date | null;
  wakeSeq: number;
}

interface IngestCompletion {
  attempted: boolean;
  calendarId: string;
  claimedReleaseSeq: number;
  claimedWakeSeq: number;
  failed: boolean;
  failureCount: number;
  leaseToken: string;
  nextDueInMs: number | null;
  parkedReason: IngestScheduleParkedReason | null;
  succeeded: boolean;
}

interface WakeIngestsInput {
  correlationId: string | null;
  debounceMs: number;
}

interface IngestScheduleHealth {
  credentialRejectedCount: number;
  dueBacklog: number;
  ineligibleCount: number;
  leasedCount: number;
  oldestDueLagMs: number;
  oldestWakeLagMs: number;
  scheduledCount: number;
  unresolvableCount: number;
  wakeBacklog: number;
}

interface ClaimedIngestRow {
  calendarId: string;
  claimedDueAt: Date | string | null;
  failureCount: number | string;
  lagMs: number | string | null;
  releaseSeq: number | string;
  userId: string;
  wakeCorrelationId: string | null;
  wakeDueAt: Date | string | null;
  wakeReceivedAt: Date | string | null;
  wakeSeq: number | string;
}

const toDate = (value: Date | string | null): Date | null => {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  return new Date(value);
};

const toRows = <TRow>(result: unknown): TRow[] => result as TRow[];

const unleased = sql`("leasedUntil" IS NULL OR "leasedUntil" <= now())`;

const buildEligibility = (lane: IngestScheduleLane): SQL => {
  if (lane === "wake") {
    return sql`"wakeDueAt" <= now()
      AND "dueAt" IS NOT NULL
      AND ("failureCount" = 0 OR "dueAt" <= now())
      AND ${unleased}`;
  }
  return sql`"dueAt" <= now() AND ${unleased}`;
};

const buildOrdering = (lane: IngestScheduleLane): SQL => {
  if (lane === "wake") {
    return sql`"wakeDueAt"`;
  }
  return sql`"dueAt"`;
};

const buildLagReference = (lane: IngestScheduleLane): SQL => {
  if (lane === "wake") {
    return sql`due."wakeDueAt"`;
  }
  return sql`due."dueAt"`;
};

const claimIngests = async (
  database: IngestScheduleDatabase,
  input: ClaimIngestsInput,
): Promise<ClaimedIngest[]> => {
  if (input.limit <= 0) {
    return [];
  }
  const lease = sql`(${input.leaseMs} * interval '1 millisecond')`;
  const result = await database.execute(sql`
    WITH due AS (
      SELECT "calendarId", "dueAt", "wakeDueAt"
      FROM "source_ingest_schedule"
      WHERE ${buildEligibility(input.lane)}
      ORDER BY ${buildOrdering(input.lane)}
      LIMIT ${input.limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "source_ingest_schedule" AS schedule
    SET
      "dueAt" = now() + ${lease},
      "leasedUntil" = now() + ${lease},
      "leaseToken" = ${input.leaseToken}::uuid,
      "lastAttemptAt" = now(),
      "updatedAt" = now()
    FROM due, "calendars"
    WHERE schedule."calendarId" = due."calendarId"
      AND "calendars"."id" = due."calendarId"
    RETURNING
      schedule."calendarId" AS "calendarId",
      "calendars"."userId" AS "userId",
      due."dueAt" AS "claimedDueAt",
      schedule."failureCount" AS "failureCount",
      greatest(0, extract(epoch from (now() - ${buildLagReference(input.lane)})) * 1000) AS "lagMs",
      schedule."releaseSeq" AS "releaseSeq",
      schedule."wakeCorrelationId" AS "wakeCorrelationId",
      schedule."wakeDueAt" AS "wakeDueAt",
      schedule."wakeReceivedAt" AS "wakeReceivedAt",
      schedule."wakeSeq" AS "wakeSeq"
  `);
  return toRows<ClaimedIngestRow>(result).map((row) => ({
    calendarId: row.calendarId,
    claimedDueAt: toDate(row.claimedDueAt),
    failureCount: Number(row.failureCount),
    lagMs: Math.round(Number(row.lagMs ?? 0)),
    leaseToken: input.leaseToken,
    releaseSeq: Number(row.releaseSeq),
    userId: row.userId,
    wakeCorrelationId: row.wakeCorrelationId,
    wakeDueAt: toDate(row.wakeDueAt),
    wakeReceivedAt: toDate(row.wakeReceivedAt),
    wakeSeq: Number(row.wakeSeq),
  }));
};

const buildCompletionValues = (completions: IngestCompletion[]): SQL =>
  sql.join(
    completions.map((completion) => sql`(
      ${completion.calendarId}::uuid,
      ${completion.leaseToken}::uuid,
      ${completion.claimedReleaseSeq}::integer,
      ${completion.claimedWakeSeq}::integer,
      ${completion.nextDueInMs}::double precision,
      ${completion.parkedReason}::text,
      ${completion.failureCount}::integer,
      ${completion.attempted}::boolean,
      ${completion.succeeded}::boolean,
      ${completion.failed}::boolean
    )`),
    sql`, `,
  );

const completeIngests = async (
  database: IngestScheduleDatabase,
  completions: IngestCompletion[],
): Promise<string[]> => {
  if (completions.length === 0) {
    return [];
  }
  const consumesWake = sql`completion."attempted" AND schedule."wakeSeq" = completion."claimedWakeSeq"`;
  const released = sql`schedule."releaseSeq" <> completion."claimedReleaseSeq"`;
  const nextDue = sql`now() + (completion."nextDueInMs" * interval '1 millisecond')`;
  const result = await database.execute(sql`
    UPDATE "source_ingest_schedule" AS schedule
    SET
      "dueAt" = CASE
        WHEN ${released} THEN schedule."dueAt"
        WHEN completion."nextDueInMs" IS NULL THEN NULL
        ELSE ${nextDue}
      END,
      "parkedReason" = CASE WHEN ${released} THEN schedule."parkedReason" ELSE completion."parkedReason" END,
      "failureCount" = CASE WHEN ${released} THEN schedule."failureCount" ELSE completion."failureCount" END,
      "lastFailureAt" = CASE
        WHEN completion."failed" AND NOT ${released} THEN now()
        ELSE schedule."lastFailureAt"
      END,
      "lastSuccessAt" = CASE WHEN completion."succeeded" THEN now() ELSE schedule."lastSuccessAt" END,
      "leasedUntil" = NULL,
      "leaseToken" = NULL,
      "wakeDueAt" = CASE
        WHEN ${consumesWake} THEN NULL
        WHEN NOT completion."attempted" AND completion."nextDueInMs" IS NOT NULL
          THEN greatest(schedule."wakeDueAt", ${nextDue})
        ELSE schedule."wakeDueAt"
      END,
      "wakeReceivedAt" = CASE WHEN ${consumesWake} THEN NULL ELSE schedule."wakeReceivedAt" END,
      "wakeCorrelationId" = CASE WHEN ${consumesWake} THEN NULL ELSE schedule."wakeCorrelationId" END,
      "updatedAt" = now()
    FROM (VALUES ${buildCompletionValues(completions)}) AS completion(
      "calendarId",
      "leaseToken",
      "claimedReleaseSeq",
      "claimedWakeSeq",
      "nextDueInMs",
      "parkedReason",
      "failureCount",
      "attempted",
      "succeeded",
      "failed"
    )
    WHERE schedule."calendarId" = completion."calendarId"
      AND schedule."leaseToken" = completion."leaseToken"
    RETURNING schedule."calendarId" AS "calendarId"
  `);
  return toRows<{ calendarId: string }>(result).map(({ calendarId }) => calendarId);
};

const buildWakeAssignments = (input: WakeIngestsInput): SQL => {
  const deadline = sql`now() + (${input.debounceMs} * interval '1 millisecond')`;
  const servedByCurrentRead = sql`"leasedUntil" > now()
    AND ("wakeReceivedAt" IS NULL OR "wakeReceivedAt" <= "lastAttemptAt")`;
  return sql`
    "wakeDueAt" = LEAST(COALESCE("wakeDueAt", ${deadline}), ${deadline}),
    "wakeReceivedAt" = CASE
      WHEN ${servedByCurrentRead} THEN now()
      ELSE COALESCE("wakeReceivedAt", now())
    END,
    "wakeCorrelationId" = CASE
      WHEN ${servedByCurrentRead} THEN ${input.correlationId}::text
      ELSE COALESCE("wakeCorrelationId", ${input.correlationId}::text)
    END,
    "wakeSeq" = "wakeSeq" + 1,
    "updatedAt" = now()
  `;
};

const wakeIngests = async (
  database: IngestScheduleDatabase,
  calendarIds: string[],
  input: WakeIngestsInput,
): Promise<string[]> => {
  if (calendarIds.length === 0) {
    return [];
  }
  const result = await database.execute(sql`
    UPDATE "source_ingest_schedule"
    SET ${buildWakeAssignments(input)}
    WHERE "calendarId" IN (${sql.join(calendarIds.map((calendarId) => sql`${calendarId}::uuid`), sql`, `)})
      AND "dueAt" IS NOT NULL
    RETURNING "calendarId"
  `);
  return toRows<{ calendarId: string }>(result).map(({ calendarId }) => calendarId);
};

const wakeUserIngests = async (
  database: IngestScheduleDatabase,
  userId: string,
  input: WakeIngestsInput,
): Promise<string[]> => {
  const result = await database.execute(sql`
    UPDATE "source_ingest_schedule"
    SET ${buildWakeAssignments(input)}
    WHERE "calendarId" IN (SELECT "id" FROM "calendars" WHERE "userId" = ${userId})
      AND "dueAt" IS NOT NULL
    RETURNING "calendarId"
  `);
  return toRows<{ calendarId: string }>(result).map(({ calendarId }) => calendarId);
};

interface ReleasedIngest {
  calendarId: string;
  leaseToken: string;
}

const releaseIngests = async (
  database: IngestScheduleDatabase,
  claims: ReleasedIngest[],
): Promise<string[]> => {
  if (claims.length === 0) {
    return [];
  }
  const result = await database.execute(sql`
    UPDATE "source_ingest_schedule" AS schedule
    SET
      "dueAt" = CASE WHEN schedule."parkedReason" = 'ineligible' THEN NULL ELSE now() END,
      "leasedUntil" = NULL,
      "leaseToken" = NULL,
      "updatedAt" = now()
    FROM (VALUES ${sql.join(
      claims.map((claim) => sql`(${claim.calendarId}::uuid, ${claim.leaseToken}::uuid)`),
      sql`, `,
    )}) AS released("calendarId", "leaseToken")
    WHERE schedule."calendarId" = released."calendarId"
      AND schedule."leaseToken" = released."leaseToken"
    RETURNING schedule."calendarId" AS "calendarId"
  `);
  return toRows<{ calendarId: string }>(result).map(({ calendarId }) => calendarId);
};

const hasSiblingReadSinceLastSuccess = async (
  database: IngestScheduleDatabase,
  calendarId: string,
): Promise<boolean> => {
  const result = await database.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM "calendars" AS target
      INNER JOIN "calendars" AS sibling
        ON sibling."accountId" = target."accountId" AND sibling."id" <> target."id"
      INNER JOIN "source_ingest_schedule" AS sibling_schedule
        ON sibling_schedule."calendarId" = sibling."id"
      LEFT JOIN "source_ingest_schedule" AS target_schedule
        ON target_schedule."calendarId" = target."id"
      WHERE target."id" = ${calendarId}::uuid
        AND sibling_schedule."lastSuccessAt" > COALESCE(target_schedule."lastSuccessAt", '-infinity'::timestamptz)
    ) AS "siblingReading"
  `);
  const [row] = toRows<{ siblingReading: boolean }>(result);
  return row?.siblingReading === true;
};

interface IngestScheduleHealthRow {
  credentialRejectedCount: number | string;
  dueBacklog: number | string;
  ineligibleCount: number | string;
  leasedCount: number | string;
  oldestDueLagMs: number | string | null;
  oldestWakeLagMs: number | string | null;
  scheduledCount: number | string;
  unresolvableCount: number | string;
  wakeBacklog: number | string;
}

const readIngestScheduleHealth = async (
  database: IngestScheduleDatabase,
): Promise<IngestScheduleHealth> => {
  const result = await database.execute(sql`
    SELECT
      count(*) FILTER (WHERE "dueAt" IS NOT NULL) AS "scheduledCount",
      count(*) FILTER (WHERE "dueAt" <= now()) AS "dueBacklog",
      count(*) FILTER (WHERE "wakeDueAt" <= now() AND "dueAt" IS NOT NULL) AS "wakeBacklog",
      count(*) FILTER (WHERE "leasedUntil" > now()) AS "leasedCount",
      count(*) FILTER (WHERE "parkedReason" = 'ineligible') AS "ineligibleCount",
      count(*) FILTER (WHERE "parkedReason" = 'credential-rejected') AS "credentialRejectedCount",
      count(*) FILTER (WHERE "parkedReason" = 'unresolvable') AS "unresolvableCount",
      extract(epoch from (now() - min("dueAt") FILTER (WHERE "dueAt" <= now()))) * 1000 AS "oldestDueLagMs",
      extract(epoch from (now() - min("wakeDueAt") FILTER (WHERE "wakeDueAt" <= now() AND "dueAt" IS NOT NULL))) * 1000 AS "oldestWakeLagMs"
    FROM "source_ingest_schedule"
  `);
  const [row] = toRows<IngestScheduleHealthRow>(result);
  return {
    credentialRejectedCount: Number(row?.credentialRejectedCount ?? 0),
    dueBacklog: Number(row?.dueBacklog ?? 0),
    ineligibleCount: Number(row?.ineligibleCount ?? 0),
    leasedCount: Number(row?.leasedCount ?? 0),
    oldestDueLagMs: Math.round(Number(row?.oldestDueLagMs ?? 0)),
    oldestWakeLagMs: Math.round(Number(row?.oldestWakeLagMs ?? 0)),
    scheduledCount: Number(row?.scheduledCount ?? 0),
    unresolvableCount: Number(row?.unresolvableCount ?? 0),
    wakeBacklog: Number(row?.wakeBacklog ?? 0),
  };
};

export {
  claimIngests,
  completeIngests,
  hasSiblingReadSinceLastSuccess,
  readIngestScheduleHealth,
  releaseIngests,
  wakeIngests,
  wakeUserIngests,
};
export type {
  ClaimIngestsInput,
  ClaimedIngest,
  IngestCompletion,
  IngestScheduleDatabase,
  IngestScheduleHealth,
  IngestScheduleLane,
  IngestScheduleParkedReason,
  ReleasedIngest,
  WakeIngestsInput,
};
