import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { eq } from "drizzle-orm";
import {
  calendarAccountsTable,
  calendarsTable,
  oauthCredentialsTable,
} from "@keeper.sh/database/schema";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const administrativeUrl = process.env.KEEPER_TEST_DATABASE_URL;
const scratchName = `keeper_reconnect_soak_${process.pid}`;
const USER_ID = "reconnect-soak-user";
const MINUTE_MS = 60_000;

const scratchUrl = (): string => {
  const url = new URL(administrativeUrl ?? "postgres://localhost");
  url.pathname = `/${scratchName}`;
  return url.toString();
};

const withAdministrativeClient = async (statements: string[]): Promise<void> => {
  const client = new SQL(administrativeUrl ?? "postgres://localhost");
  try {
    for (const statement of statements) {
      await client.unsafe(statement);
    }
  } finally {
    await client.end();
  }
};

let client: SQL = new SQL(administrativeUrl ?? "postgres://localhost");
let database: ReturnType<typeof drizzle> = drizzle(client);

const state: {
  fetchCalls: number;
  fetchEvents: () => Promise<{ events: unknown[] }>;
  isCurrent: () => Promise<boolean>;
  lockAcquired: boolean;
} = {
  fetchCalls: 0,
  fetchEvents: () => Promise.resolve({ events: [] }),
  isCurrent: () => Promise.resolve(true),
  lockAcquired: true,
};

vi.mock("@/context", () => ({
  get database() {
    return database;
  },
  refreshLockRedis: {},
  refreshLockStore: null,
}));

vi.mock("@/env", () => ({
  default: {
    BLOCK_PRIVATE_RESOLUTION: false,
    DATABASE_URL: "postgres://localhost:5432/keeper",
    REDIS_URL: "redis://localhost:6379",
  },
}));

const acquireLock = (): Promise<Record<string, unknown>> => {
  if (!state.lockAcquired) {
    return Promise.resolve({ acquired: false });
  }
  return Promise.resolve({
    acquired: true,
    handle: {
      isCurrent: () => state.isCurrent(),
      release: () => Promise.resolve(),
    },
  });
};

vi.mock("@keeper.sh/sync", () => ({
  createSyncLock: () => ({
    acquire: () => acquireLock(),
  }),
}));

vi.mock("@keeper.sh/calendar/google", () => ({
  createGoogleSourceFetcher: () => ({
    fetchEvents: () => {
      state.fetchCalls += 1;
      return state.fetchEvents();
    },
  }),
}));

vi.mock("@/utils/enqueue-destination-syncs", () => ({
  enqueueDestinationSyncsForUsers: () => Promise.resolve(),
}));

vi.mock("@/utils/logging", () => ({
  context: (callback: () => Promise<unknown>) => callback(),
  widelog: {
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    set: () => null,
    time: {
      measure: (_name: string, callback: () => Promise<unknown>) => callback(),
    },
  },
}));

const ingestSourcesModule = await import("../../src/jobs/ingest-sources");
const ingestSourcesJob = ingestSourcesModule.default;

const { clearSourceReauthentication } = await import(
  "../../../api/src/utils/source-reauthentication"
);

type ReconnectDatabase = Parameters<typeof clearSourceReauthentication>[0];

const runTick = (): Promise<void> => ingestSourcesJob.callback() as Promise<void>;

const deadCredentialError = (): Error =>
  Object.assign(new Error("Token refresh failed (400): invalid_grant"), {
    oauthReauthRequired: true,
  });

interface SeededSource {
  accountId: string;
  calendarId: string;
  credentialId: string;
}

const seedSource = async (label: string): Promise<SeededSource> => {
  const [credential] = await database
    .insert(oauthCredentialsTable)
    .values({
      accessToken: `access-${label}`,
      email: `${label}@example.com`,
      expiresAt: new Date(Date.now() + 60 * MINUTE_MS),
      provider: "google",
      refreshToken: `refresh-${label}`,
      userId: USER_ID,
    })
    .returning({ id: oauthCredentialsTable.id });
  const [account] = await database
    .insert(calendarAccountsTable)
    .values({
      authType: "oauth",
      oauthCredentialId: credential?.id,
      provider: "google",
      userId: USER_ID,
    })
    .returning({ id: calendarAccountsTable.id });
  const [calendar] = await database
    .insert(calendarsTable)
    .values({
      accountId: account?.id ?? "",
      calendarType: "oauth",
      capabilities: ["pull"],
      externalCalendarId: "primary",
      name: label,
      userId: USER_ID,
    })
    .returning({ id: calendarsTable.id });

  if (!credential || !account || !calendar) {
    throw new Error("Failed to seed OAuth source");
  }

  return { accountId: account.id, calendarId: calendar.id, credentialId: credential.id };
};

const readCalendar = async (calendarId: string) => {
  const [row] = await database
    .select({
      disabled: calendarsTable.disabled,
      failureCount: calendarsTable.failureCount,
      ingestFailureCount: calendarsTable.ingestFailureCount,
      ingestLastFailureAt: calendarsTable.ingestLastFailureAt,
      ingestNextAttemptAt: calendarsTable.ingestNextAttemptAt,
      lastFailureAt: calendarsTable.lastFailureAt,
      nextAttemptAt: calendarsTable.nextAttemptAt,
      updatedAt: calendarsTable.updatedAt,
    })
    .from(calendarsTable)
    .where(eq(calendarsTable.id, calendarId))
    .limit(1);
  return row;
};

const readFlag = async (accountId: string): Promise<boolean | undefined> => {
  const [row] = await database
    .select({ needsReauthentication: calendarAccountsTable.needsReauthentication })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.id, accountId))
    .limit(1);
  return row?.needsReauthentication;
};

const reconnect = async (credentialId: string, token: string): Promise<void> => {
  await database
    .update(oauthCredentialsTable)
    .set({
      accessToken: `access-${token}`,
      expiresAt: new Date(Date.now() + 60 * MINUTE_MS),
      needsReauthentication: false,
      refreshToken: `refresh-${token}`,
    })
    .where(eq(oauthCredentialsTable.id, credentialId));

  await clearSourceReauthentication(database as unknown as ReconnectDatabase, credentialId);
};

const armPush = async (calendarId: string, nextAttemptAt: Date): Promise<void> => {
  await database
    .update(calendarsTable)
    .set({ failureCount: 4, lastFailureAt: nextAttemptAt, nextAttemptAt })
    .where(eq(calendarsTable.id, calendarId));
};

const makeDue = async (calendarId: string): Promise<void> => {
  await database
    .update(calendarsTable)
    .set({ ingestNextAttemptAt: new Date(Date.now() - MINUTE_MS) })
    .where(eq(calendarsTable.id, calendarId));
};

beforeAll(async () => {
  if (!administrativeUrl) {
    return;
  }

  await withAdministrativeClient([
    `drop database if exists "${scratchName}"`,
    `create database "${scratchName}"`,
  ]);

  const migrationScript = `${import.meta.dirname}/../../../../packages/database/scripts/migrate.ts`;
  const migration = await Bun.$`bun ${migrationScript}`
    .env({ ...process.env, DATABASE_URL: scratchUrl() })
    .quiet()
    .nothrow();
  if (migration.exitCode !== 0) {
    throw new Error(`Migration failed: ${migration.stderr.toString()}`);
  }

  client = new SQL(scratchUrl());
  database = drizzle(client);

  await client.unsafe(`
    insert into "user" (id, email, name)
    values ('${USER_ID}', 'reconnect-soak@example.com', 'Reconnect Soak')
  `);
});

afterAll(async () => {
  if (!administrativeUrl) {
    return;
  }
  await client.end();
  await withAdministrativeClient([`drop database if exists "${scratchName}"`]);
});

beforeEach(async () => {
  if (!administrativeUrl) {
    return;
  }
  state.fetchCalls = 0;
  state.fetchEvents = () => Promise.resolve({ events: [] });
  state.isCurrent = () => Promise.resolve(true);
  state.lockAcquired = true;
  await client.unsafe("delete from calendars");
  await client.unsafe("delete from calendar_accounts");
  await client.unsafe("delete from oauth_credentials");
});

describe.skipIf(!administrativeUrl)("a dead credential soaked over many scheduler ticks", () => {
  it("touches the provider once and then holds perfectly still", async () => {
    const source = await seedSource("soak-still");
    state.fetchEvents = () => Promise.reject(deadCredentialError());

    await runTick();
    const afterFirst = await readCalendar(source.calendarId);
    expect(state.fetchCalls).toBe(1);
    expect(afterFirst?.ingestFailureCount).toBe(1);

    for (let tick = 0; tick < 20; tick += 1) {
      await runTick();
    }

    const afterSoak = await readCalendar(source.calendarId);
    expect(state.fetchCalls).toBe(1);
    expect(afterSoak?.ingestFailureCount).toBe(1);
    expect(afterSoak?.ingestNextAttemptAt?.getTime())
      .toBe(afterFirst?.ingestNextAttemptAt?.getTime());
    expect(afterSoak?.updatedAt?.getTime()).toBe(afterFirst?.updatedAt?.getTime());
    expect(await readFlag(source.accountId)).toBe(true);
  });

  it("grows the exponent monotonically across forced-due ticks and never walks back", async () => {
    const source = await seedSource("soak-monotonic");
    state.fetchEvents = () => Promise.reject(deadCredentialError());

    const delays: number[] = [];
    for (let round = 0; round < 8; round += 1) {
      await runTick();
      const row = await readCalendar(source.calendarId);
      const armedAt = row?.ingestLastFailureAt?.getTime() ?? 0;
      const dueAt = row?.ingestNextAttemptAt?.getTime() ?? 0;
      delays.push(dueAt - armedAt);
      await makeDue(source.calendarId);
    }

    expect(state.fetchCalls).toBe(8);
    for (let index = 1; index < delays.length; index += 1) {
      expect(delays[index]).toBeGreaterThanOrEqual(delays[index - 1] ?? 0);
    }
    expect(delays.at(-1)).toBe(6 * 60 * MINUTE_MS);
  });
});

describe.skipIf(!administrativeUrl)("reconnecting after the soak", () => {
  it("resumes on the very next tick and then stays converged", async () => {
    const source = await seedSource("soak-resume");
    state.fetchEvents = () => Promise.reject(deadCredentialError());

    for (let round = 0; round < 4; round += 1) {
      await runTick();
      await makeDue(source.calendarId);
    }
    const soaked = await readCalendar(source.calendarId);
    expect(soaked?.ingestFailureCount).toBe(4);

    await reconnect(source.credentialId, "reborn");

    const afterReconnect = await readCalendar(source.calendarId);
    expect(afterReconnect).toMatchObject({
      failureCount: 0,
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
      lastFailureAt: null,
      nextAttemptAt: null,
    });
    expect(await readFlag(source.accountId)).toBe(false);

    state.fetchEvents = () => Promise.resolve({ events: [] });
    state.fetchCalls = 0;

    for (let tick = 0; tick < 6; tick += 1) {
      await runTick();
    }

    expect(state.fetchCalls).toBe(6);
    expect(await readCalendar(source.calendarId)).toMatchObject({
      failureCount: 0,
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
      nextAttemptAt: null,
    });
    expect(await readFlag(source.accountId)).toBe(false);
  });

  it("clears the push clock a destination failure armed on the same calendar", async () => {
    const source = await seedSource("soak-push");
    await armPush(source.calendarId, new Date(Date.now() + 60 * MINUTE_MS));
    state.fetchEvents = () => Promise.reject(deadCredentialError());
    await runTick();

    await reconnect(source.credentialId, "push-reborn");

    expect(await readCalendar(source.calendarId)).toMatchObject({
      failureCount: 0,
      lastFailureAt: null,
      nextAttemptAt: null,
    });
  });

  it("restarts the exponent instead of compounding across repeated break/fix cycles", async () => {
    const source = await seedSource("soak-cycle");
    const firstDelays: number[] = [];

    for (let cycle = 0; cycle < 5; cycle += 1) {
      state.fetchEvents = () => Promise.reject(deadCredentialError());
      await runTick();
      const row = await readCalendar(source.calendarId);
      firstDelays.push(
        (row?.ingestNextAttemptAt?.getTime() ?? 0) - (row?.ingestLastFailureAt?.getTime() ?? 0),
      );
      expect(row?.ingestFailureCount).toBe(1);

      await reconnect(source.credentialId, `cycle-${cycle}`);
      state.fetchEvents = () => Promise.resolve({ events: [] });
      await runTick();
      expect(await readCalendar(source.calendarId)).toMatchObject({
        ingestFailureCount: 0,
        ingestNextAttemptAt: null,
      });
    }

    expect(new Set(firstDelays).size).toBe(1);
    expect(firstDelays[0]).toBe(5 * MINUTE_MS);
  });

  it("parks for exactly one step when the failing run was already in flight, then recovers", async () => {
    const source = await seedSource("soak-inflight");
    const gate = Promise.withResolvers<null>();

    state.fetchEvents = async () => {
      await gate.promise;
      throw deadCredentialError();
    };

    const inFlight = runTick();
    while (state.fetchCalls === 0) {
      await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
    }

    await reconnect(source.credentialId, "inflight");
    gate.resolve(null);
    await inFlight;

    const parked = await readCalendar(source.calendarId);
    expect(parked?.ingestFailureCount).toBe(1);
    expect((parked?.ingestNextAttemptAt?.getTime() ?? 0)
      - (parked?.ingestLastFailureAt?.getTime() ?? 0)).toBe(5 * MINUTE_MS);
    expect(await readFlag(source.accountId)).toBe(false);

    state.fetchEvents = () => Promise.resolve({ events: [] });
    state.fetchCalls = 0;
    await runTick();
    expect(state.fetchCalls).toBe(0);

    await makeDue(source.calendarId);
    await runTick();
    expect(state.fetchCalls).toBe(1);
    expect(await readCalendar(source.calendarId)).toMatchObject({
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
    });
  });
});

describe.skipIf(!administrativeUrl)("a calendar the user paused on purpose", () => {
  it("stays paused through a reconnect and is never ingested until resumed", async () => {
    const source = await seedSource("soak-paused");
    state.fetchEvents = () => Promise.reject(deadCredentialError());
    await runTick();

    await database
      .update(calendarsTable)
      .set({ disabled: true })
      .where(eq(calendarsTable.id, source.calendarId));

    await reconnect(source.credentialId, "paused-reborn");

    const reconnected = await readCalendar(source.calendarId);
    expect(reconnected?.disabled).toBe(true);

    state.fetchEvents = () => Promise.resolve({ events: [] });
    state.fetchCalls = 0;
    for (let tick = 0; tick < 5; tick += 1) {
      await runTick();
    }
    expect(state.fetchCalls).toBe(0);

    await database
      .update(calendarsTable)
      .set({ disabled: false })
      .where(eq(calendarsTable.id, source.calendarId));

    await runTick();
    expect(state.fetchCalls).toBe(1);
  });
});
