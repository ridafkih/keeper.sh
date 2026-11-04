import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SQL } from "bun";
import { DEFAULT_INGEST_INTERVAL_DIALS } from "@keeper.sh/calendar";
import {
  claimIngests,
  closeDatabase,
  completeIngests,
  createDatabase,
  wakeIngests,
} from "@keeper.sh/database";
import type { ClaimedIngest } from "@keeper.sh/database";
import { startIngestLane } from "../../src/ingest/ingest-lane";
import { runIngestRound } from "../../src/ingest/run-ingest-round";
import type { IngestRoundDependencies } from "../../src/ingest/run-ingest-round";
import type { SourceCalendarsIngestion } from "../../src/ingest/ingest-sources";
import type { IngestScheduleContext } from "../../src/ingest/schedule-context";
import type { IngestLane } from "../../src/utils/ingest-lanes";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const migrationScript = `${import.meta.dirname}/../../../../packages/database/scripts/migrate.ts`;
const databaseName = `keeper_cron_scheduler_${process.pid}`;

const BROKEN_COUNT = 60;
const HEALTHY_COUNT = 140;
const BATCH = 25;
const LEASE_MS = 60_000;

const buildDatabaseUrl = (name: string): string => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${name}`;
  return url.toString();
};

const withAdministrativeClient = async (run: (client: SQL) => Promise<void>): Promise<void> => {
  const client = new SQL(administrativeUrl ?? "");
  try {
    await run(client);
  } finally {
    await client.close();
  }
};

const waitFor = async (condition: () => boolean, timeoutMs = 20_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error("condition never held");
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
};

const seed = async (client: SQL): Promise<{ brokenIds: Set<string>; healthyIds: Set<string> }> => {
  await client`INSERT INTO "user" ("id", "email", "name") VALUES ('owner', 'owner@example.com', 'Owner')`;
  const [account] = await client<{ id: string }[]>`
    INSERT INTO "calendar_accounts" ("authType", "provider", "userId")
    VALUES ('oauth', 'google', 'owner') RETURNING "id"
  `;
  const insert = async (count: number): Promise<Set<string>> => {
    const rows = await client<{ id: string }[]>`
      INSERT INTO "calendars" ("accountId", "calendarType", "name", "userId")
      SELECT ${account?.id}::uuid, 'oauth', 'Fixture ' || n, 'owner' FROM generate_series(1, ${count}::int) AS n
      RETURNING "id"
    `;
    return new Set(rows.map(({ id }) => id));
  };
  const brokenIds = await insert(BROKEN_COUNT);
  const healthyIds = await insert(HEALTHY_COUNT);
  await client`
    UPDATE "source_ingest_schedule" SET "dueAt" = now() - interval '1 day'
    WHERE "calendarId" IN ${client([...brokenIds])}
  `;
  return { brokenIds, healthyIds };
};

describe.skipIf(!administrativeUrl)("the ingest scheduler against Postgres", () => {
  let client: SQL | null = null;
  let database: Awaited<ReturnType<typeof createDatabase>> | null = null;

  beforeAll(async () => {
    await withAdministrativeClient(async (admin) => {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    });
    const migrated = await Bun.$`bun ${migrationScript}`
      .env({ ...process.env, DATABASE_URL: buildDatabaseUrl(databaseName) })
      .quiet()
      .nothrow();
    if (migrated.exitCode !== 0) {
      throw new Error(`Migration failed: ${migrated.stderr.toString()}`);
    }
    client = new SQL(buildDatabaseUrl(databaseName));
    database = await createDatabase(buildDatabaseUrl(databaseName), { maxConnections: 4 });
  }, 300_000);

  afterAll(async () => {
    if (database) {
      closeDatabase(database, { graceSeconds: 1 });
    }
    await client?.close();
    await withAdministrativeClient(async (admin) => {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    });
  }, 120_000);

  it("reads every healthy calendar once even when broken calendars outnumber the batch", async () => {
    if (!client || !database) {
      throw new Error("database not ready");
    }
    const connected = database;
    const { brokenIds, healthyIds } = await seed(client);
    const reads = new Map<string, number>();
    const enqueued: string[][] = [];

    const dependencies: IngestRoundDependencies = {
      completeIngests: (completions) => completeIngests(connected, completions),
      dials: DEFAULT_INGEST_INTERVAL_DIALS,
      enqueueDestinationSyncs: (userIds) => {
        enqueued.push(userIds);
        return Promise.resolve();
      },
      ingestCalendars: (calendarIds): Promise<SourceCalendarsIngestion> => {
        for (const calendarId of calendarIds) {
          reads.set(calendarId, (reads.get(calendarId) ?? 0) + 1);
        }
        return Promise.resolve({
          failures: [],
          result: {
            abortedCalendarIds: [],
            added: 0,
            affectedUserIds: [],
            errors: 0,
            firstIngestUserIds: [],
            outcomes: calendarIds.map((calendarId) => {
              if (brokenIds.has(calendarId)) {
                return { calendarId, outcome: { kind: "credential-rejected" as const } };
              }
              return { calendarId, outcome: { kind: "ingested" as const } };
            }),
            removed: 0,
          },
        });
      },
      observe: () => null,
      random: Math.random,
      recordError: (error) => {
        throw error;
      },
      recordFirstIngestSyncRequests: () => Promise.resolve(),
      resolveScheduleContexts: (calendarIds) => Promise.resolve(new Map(calendarIds.map(
        (calendarId): [string, IngestScheduleContext] => [
          calendarId,
          { dormant: false, plan: "free", pushHealthy: false },
        ],
      ))),
      resources: {} as IngestLane,
    };

    const lane = startIngestLane<ClaimedIngest>({
      batchSize: BATCH,
      capacity: BATCH,
      claim: (limit) => claimIngests(connected, {
        lane: "fleet",
        leaseMs: LEASE_MS,
        leaseToken: crypto.randomUUID(),
        limit,
      }),
      idleMs: 20,
      onError: (error) => {
        throw error;
      },
      runRound: (claims) => runIngestRound("fleet", claims, dependencies),
    });

    try {
      await waitFor(() => [...healthyIds].every((calendarId) => reads.has(calendarId)));
      await waitFor(() => [...brokenIds].every((calendarId) => reads.has(calendarId)));
    } finally {
      await lane.stop();
    }

    for (const calendarId of healthyIds) {
      expect(reads.get(calendarId)).toBe(1);
    }
    for (const calendarId of brokenIds) {
      expect(reads.get(calendarId)).toBe(1);
    }
    const [remaining] = await client<{ due: string; parked: string }[]>`
      SELECT
        count(*) FILTER (WHERE "dueAt" <= now())::text AS "due",
        count(*) FILTER (WHERE "parkedReason" = 'credential-rejected')::text AS "parked"
      FROM "source_ingest_schedule"
    `;
    expect(remaining).toEqual({ due: "0", parked: String(BROKEN_COUNT) });
  }, 60_000);

  it("reads a woken calendar on the wake lane and hands its webhook to the destination sync", async () => {
    if (!client || !database) {
      throw new Error("database not ready");
    }
    const connected = database;
    const [scheduled] = await client<{ calendarId: string }[]>`
      SELECT "calendarId" FROM "source_ingest_schedule" WHERE "parkedReason" IS NULL LIMIT 1
    `;
    const calendarId = scheduled?.calendarId ?? "";
    const enqueued: { correlationIdByUserId: Record<string, string>; userIds: string[] }[] = [];
    const dependencies: IngestRoundDependencies = {
      completeIngests: (completions) => completeIngests(connected, completions),
      dials: DEFAULT_INGEST_INTERVAL_DIALS,
      enqueueDestinationSyncs: (userIds, _trigger, correlationIdByUserId) => {
        enqueued.push({ correlationIdByUserId, userIds });
        return Promise.resolve();
      },
      ingestCalendars: (calendarIds) => Promise.resolve({
        failures: [],
        result: {
          abortedCalendarIds: [],
          added: 1,
          affectedUserIds: ["owner"],
          errors: 0,
          firstIngestUserIds: [],
          outcomes: calendarIds.map((id) => ({ calendarId: id, outcome: { kind: "ingested" as const } })),
          removed: 0,
        },
      }),
      observe: () => null,
      random: Math.random,
      recordError: (error) => {
        throw error;
      },
      recordFirstIngestSyncRequests: () => Promise.resolve(),
      resolveScheduleContexts: () => Promise.resolve(new Map()),
      resources: {} as IngestLane,
    };
    const lane = startIngestLane<ClaimedIngest>({
      batchSize: BATCH,
      capacity: BATCH,
      claim: (limit) => claimIngests(connected, {
        lane: "wake",
        leaseMs: LEASE_MS,
        leaseToken: crypto.randomUUID(),
        limit,
      }),
      idleMs: 20,
      onError: (error) => {
        throw error;
      },
      runRound: (claims) => runIngestRound("wake", claims, dependencies),
    });

    try {
      await wakeIngests(connected, [calendarId], { correlationId: "webhook-1", debounceMs: 0 });
      await waitFor(() => enqueued.length > 0, 5000);
    } finally {
      await lane.stop();
    }

    expect(enqueued).toEqual([{
      correlationIdByUserId: { owner: "webhook-1" },
      userIds: ["owner"],
    }]);
    const [row] = await client<{ wakeDueAt: Date | null }[]>`
      SELECT "wakeDueAt" FROM "source_ingest_schedule" WHERE "calendarId" = ${calendarId}::uuid
    `;
    expect(row?.wakeDueAt).toBeNull();
  }, 60_000);
});
