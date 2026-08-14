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
const scratchName = `keeper_ingest_backoff_${process.pid}`;
const USER_ID = "ingest-backoff-user";
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

const runTick = (): Promise<void> => ingestSourcesJob.callback() as Promise<void>;

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
      ingestFailureCount: calendarsTable.ingestFailureCount,
      ingestLastFailureAt: calendarsTable.ingestLastFailureAt,
      ingestNextAttemptAt: calendarsTable.ingestNextAttemptAt,
      updatedAt: calendarsTable.updatedAt,
    })
    .from(calendarsTable)
    .where(eq(calendarsTable.id, calendarId))
    .limit(1);
  return row;
};

const readAccountFlag = async (accountId: string): Promise<boolean | undefined> => {
  const [row] = await database
    .select({ needsReauthentication: calendarAccountsTable.needsReauthentication })
    .from(calendarAccountsTable)
    .where(eq(calendarAccountsTable.id, accountId))
    .limit(1);
  return row?.needsReauthentication;
};

const armBackoff = async (
  calendarId: string,
  failureCount: number,
  nextAttemptAt: Date | null,
): Promise<void> => {
  await database
    .update(calendarsTable)
    .set({
      ingestFailureCount: failureCount,
      ingestLastFailureAt: nextAttemptAt,
      ingestNextAttemptAt: nextAttemptAt,
    })
    .where(eq(calendarsTable.id, calendarId));
};

const waitForFetchCalls = async (expected: number): Promise<void> => {
  const deadline = Date.now() + 5000;
  while (state.fetchCalls < expected) {
    if (Date.now() > deadline) {
      throw new Error(`Only ${state.fetchCalls} of ${expected} fetches started`);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
};

const deadCredentialError = (): Error =>
  Object.assign(new Error("Token refresh failed (400): invalid_grant"), {
    oauthReauthRequired: true,
  });

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
    values ('${USER_ID}', 'ingest-backoff@example.com', 'Ingest Backoff')
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

describe.skipIf(!administrativeUrl)("a dead OAuth credential against a real database", () => {
  it("arms a five minute backoff and flags the account on the first failing tick", async () => {
    const { accountId, calendarId } = await seedSource("first-failure");
    state.fetchEvents = () => Promise.reject(deadCredentialError());
    const before = Date.now();

    await expect(runTick()).resolves.toBeUndefined();

    const row = await readCalendar(calendarId);
    expect(row?.ingestFailureCount).toBe(1);
    expect(row?.ingestNextAttemptAt?.getTime()).toBeGreaterThanOrEqual(before + 5 * MINUTE_MS);
    expect(row?.ingestNextAttemptAt?.getTime()).toBeLessThanOrEqual(Date.now() + 5 * MINUTE_MS);
    expect(await readAccountFlag(accountId)).toBe(true);
  });

  it("never touches the provider again while the stored backoff window is open", async () => {
    const { calendarId } = await seedSource("inside-window");
    state.fetchEvents = () => Promise.reject(deadCredentialError());

    await runTick();
    const armed = await readCalendar(calendarId);
    state.fetchCalls = 0;

    await runTick();
    await runTick();
    await runTick();

    expect(state.fetchCalls).toBe(0);
    expect(await readCalendar(calendarId)).toEqual(armed);
  });

  it("doubles the delay once per due tick instead of oscillating", async () => {
    const { calendarId } = await seedSource("doubling");
    state.fetchEvents = () => Promise.reject(deadCredentialError());
    const delays: number[] = [];

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const start = Date.now();
      await runTick();
      const row = await readCalendar(calendarId);
      delays.push(Math.round(((row?.ingestNextAttemptAt?.getTime() ?? 0) - start) / MINUTE_MS));
      await armBackoff(calendarId, row?.ingestFailureCount ?? 0, new Date(start - MINUTE_MS));
    }

    expect(delays).toEqual([5, 10, 20, 40]);
  });

  it("clears the stored backoff on the first tick that succeeds", async () => {
    const { calendarId } = await seedSource("recovery");
    await armBackoff(calendarId, 6, new Date(Date.now() - MINUTE_MS));

    await runTick();

    expect(await readCalendar(calendarId)).toMatchObject({
      ingestFailureCount: 0,
      ingestLastFailureAt: null,
      ingestNextAttemptAt: null,
    });
  });

  it("resumes on the very next tick after the user reconnects mid-backoff", async () => {
    const { accountId, calendarId } = await seedSource("reconnect");
    state.fetchEvents = () => Promise.reject(deadCredentialError());
    await runTick();
    expect(await readAccountFlag(accountId)).toBe(true);

    state.fetchEvents = () => Promise.resolve({ events: [] });
    await database
      .update(calendarAccountsTable)
      .set({ needsReauthentication: false })
      .where(eq(calendarAccountsTable.id, accountId));
    await database
      .update(calendarsTable)
      .set({
        ingestFailureCount: 0,
        ingestLastFailureAt: null,
        ingestNextAttemptAt: null,
      })
      .where(eq(calendarsTable.id, calendarId));
    state.fetchCalls = 0;

    await runTick();

    expect(state.fetchCalls).toBe(1);
    expect(await readAccountFlag(accountId)).toBe(false);
  });

  it("does not flag the account when the credential was rotated during the run", async () => {
    const { accountId, calendarId, credentialId } = await seedSource("rotated");
    state.fetchEvents = async () => {
      await database
        .update(oauthCredentialsTable)
        .set({ refreshToken: "reconnected-refresh-token" })
        .where(eq(oauthCredentialsTable.id, credentialId));
      throw deadCredentialError();
    };

    await runTick();

    expect(await readAccountFlag(accountId)).toBe(false);
    const parked = await readCalendar(calendarId);
    expect(parked?.ingestFailureCount).toBe(1);
  });

  it("leaves the attempt clock alone when a reconnect landed mid-run", async () => {
    const { accountId, calendarId } = await seedSource("mid-run-reconnect");
    await armBackoff(calendarId, 3, new Date(Date.now() - MINUTE_MS));
    state.fetchEvents = async () => {
      await database
        .update(calendarsTable)
        .set({
          ingestFailureCount: 0,
          ingestLastFailureAt: null,
          ingestNextAttemptAt: null,
        })
        .where(eq(calendarsTable.id, calendarId));
      throw deadCredentialError();
    };

    await runTick();

    expect(await readCalendar(calendarId)).toMatchObject({
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
    });
    expect(await readAccountFlag(accountId)).toBe(false);
  });

  it("caps the delay at six hours without oscillating back down", async () => {
    const { calendarId } = await seedSource("cap");
    state.fetchEvents = () => Promise.reject(deadCredentialError());
    const delays: number[] = [];

    for (const failureCount of [7, 8, 20]) {
      await armBackoff(calendarId, failureCount, new Date(Date.now() - MINUTE_MS));
      const start = Date.now();
      await runTick();
      const row = await readCalendar(calendarId);
      delays.push(Math.round(((row?.ingestNextAttemptAt?.getTime() ?? 0) - start) / MINUTE_MS));
    }

    expect(delays).toEqual([360, 360, 360]);
  });

  it("clears a stale failure count when the run is superseded mid-flight", async () => {
    const { calendarId } = await seedSource("superseded");
    await armBackoff(calendarId, 6, new Date(Date.now() - MINUTE_MS));
    state.isCurrent = () => Promise.resolve(false);

    await runTick();

    expect(await readCalendar(calendarId)).toMatchObject({
      ingestFailureCount: 0,
      ingestNextAttemptAt: null,
    });
  });

  it("arms five minutes, not the stale cap, on the failure after a superseded run", async () => {
    const { calendarId } = await seedSource("superseded-then-failure");
    await armBackoff(calendarId, 6, new Date(Date.now() - MINUTE_MS));
    state.isCurrent = () => Promise.resolve(false);
    await runTick();

    state.isCurrent = () => Promise.resolve(true);
    state.fetchEvents = () => Promise.reject(deadCredentialError());
    const start = Date.now();
    await runTick();

    const row = await readCalendar(calendarId);
    expect(row?.ingestFailureCount).toBe(1);
    expect(
      Math.round(((row?.ingestNextAttemptAt?.getTime() ?? 0) - start) / MINUTE_MS),
    ).toBe(5);
  });

  it("writes nothing at all when another worker holds the lease", async () => {
    const { calendarId } = await seedSource("contended");
    await armBackoff(calendarId, 2, new Date(Date.now() - MINUTE_MS));
    const before = await readCalendar(calendarId);
    state.lockAcquired = false;

    await runTick();
    await runTick();

    expect(state.fetchCalls).toBe(0);
    expect(await readCalendar(calendarId)).toEqual(before);
  });

  it("counts a single failure when two ticks overlap on the same calendar", async () => {
    const { calendarId } = await seedSource("overlapping");
    const gate = Promise.withResolvers<null>();
    state.fetchEvents = async () => {
      await gate.promise;
      throw deadCredentialError();
    };
    const start = Date.now();

    const first = runTick();
    await waitForFetchCalls(1);
    const second = runTick();
    await waitForFetchCalls(2);
    gate.resolve(null);
    await Promise.all([first, second]);

    const row = await readCalendar(calendarId);
    expect(state.fetchCalls).toBe(2);
    expect(row?.ingestFailureCount).toBe(1);
    expect(
      Math.round(((row?.ingestNextAttemptAt?.getTime() ?? 0) - start) / MINUTE_MS),
    ).toBe(5);
  });

  it("keeps a healthy source untouched tick after tick", async () => {
    const { calendarId } = await seedSource("steady");

    await runTick();
    const first = await readCalendar(calendarId);
    await runTick();
    await runTick();

    expect(state.fetchCalls).toBe(3);
    expect(await readCalendar(calendarId)).toEqual(first);
  });
});
