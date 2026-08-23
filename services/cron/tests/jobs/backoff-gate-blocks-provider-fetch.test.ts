import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

const harness = vi.hoisted(() => {
  interface GateLike {
    hasFreePermit: () => boolean;
    inFlight: () => number;
    run: <TResult>(operation: () => Promise<TResult>) => Promise<TResult>;
  }

  const state = {
    caldavFetcherOptions: [] as Record<string, unknown>[],
    caldavRows: [] as Record<string, unknown>[],
    calendarRow: null as Record<string, unknown> | null,
    icsFetcherOptions: [] as Record<string, unknown>[],
    icsRows: [] as Record<string, unknown>[],
    oauthFetcherOptions: [] as Record<string, unknown>[],
    oauthRows: [] as Record<string, unknown>[],
  };

  const wrapGateFactory = (factory: (limit: number) => GateLike) =>
    (limit: number): GateLike => factory(limit);

  const resolveLimited = (): unknown[] => {
    if (state.calendarRow) {
      return [state.calendarRow];
    }
    return [];
  };

  const resolveListing = (fields: Record<string, unknown>): unknown[] => {
    if ("oauthCredentialId" in fields) {
      return state.oauthRows;
    }
    if ("encryptedPassword" in fields) {
      return state.caldavRows;
    }
    if ("treatFullDayTimedEventsAsAllDay" in fields) {
      return state.icsRows;
    }
    return [];
  };

  const createSelectBuilder = (fields: Record<string, unknown>) => {
    const builder: Record<string, unknown> = {};
    const chain = (): unknown => builder;
    builder.from = chain;
    builder.innerJoin = chain;
    builder.leftJoin = chain;
    const bare: unknown[] = [];
    if ("count" in fields) {
      bare.push({ count: 0 });
    }
    builder.where = (): unknown => Object.assign(Promise.resolve(bare), {
      limit: (): Promise<unknown[]> => Promise.resolve(resolveLimited()),
      orderBy: (): Promise<unknown[]> => Promise.resolve(resolveListing(fields)),
    });
    return builder;
  };

  const updateBuilder = {
    set: () => ({
      where: () => Object.assign(Promise.resolve([]), {
        returning: (): Promise<unknown[]> => Promise.resolve([]),
      }),
    }),
  };

  const insertBuilder = {
    values: () => ({ onConflictDoUpdate: (): Promise<unknown[]> => Promise.resolve([]) }),
  };

  const database = {
    insert: () => insertBuilder,
    select: (fields: Record<string, unknown>) => createSelectBuilder(fields),
    transaction: (callback: (transaction: unknown) => Promise<unknown>): Promise<unknown> =>
      callback({ execute: (): Promise<unknown[]> => Promise.resolve([]) }),
    update: () => updateBuilder,
  };

  return {
    database,
    state,
    wrapGateFactory,
  };
});

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  type GateFactory = Parameters<typeof harness.wrapGateFactory>[0];
  return {
    ...actual,
    createConcurrencyGate: harness.wrapGateFactory(actual.createConcurrencyGate as GateFactory),
    createOutlookAccountSemaphore: () => ({
      acquireLease: (): Promise<{ key: string; token: string }> =>
        Promise.resolve({ key: "lease-key", token: "lease-token" }),
      release: (): Promise<void> => Promise.resolve(),
    }),
    ingestSource: async (
      options: { fetchEvents: () => Promise<unknown> },
    ): Promise<{ eventsAdded: number; eventsRemoved: number }> => {
      await options.fetchEvents();
      return { eventsAdded: 1, eventsRemoved: 0 };
    },
  };
});

vi.mock("@keeper.sh/calendar/ics", () => ({
  createIcsSourceFetcher: (options: Record<string, unknown>) => {
    harness.state.icsFetcherOptions.push(options);
    return { fetchEvents: (): Promise<unknown> => Promise.resolve({ events: [] }) };
  },
  interpretFullDayTimedEventsAsAllDay: (events: unknown) => events,
  persistCalendarSnapshot: (): Promise<void> => Promise.resolve(),
}));

vi.mock("@keeper.sh/calendar/outlook", () => ({
  createOutlookSourceFetcher: (options: Record<string, unknown>) => {
    harness.state.oauthFetcherOptions.push(options);
    return { fetchEvents: (): Promise<unknown> => Promise.resolve({ events: [] }) };
  },
}));

vi.mock("@keeper.sh/calendar/caldav", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createCalDAVSourceFetcher: (options: Record<string, unknown>) => {
      harness.state.caldavFetcherOptions.push(options);
      return { fetchEvents: (): Promise<unknown> => Promise.resolve({ events: [] }) };
    },
    createCalendarDiscoveryCache: () => ({}),
  };
});

vi.mock("@keeper.sh/database", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    decryptPassword: () => "plaintext",
  };
});

vi.mock("@keeper.sh/sync", () => ({
  createSyncLock: () => ({
    acquire: () => Promise.resolve({
      acquired: true,
      handle: {
        isCurrent: (): Promise<boolean> => Promise.resolve(true),
        release: (): Promise<void> => Promise.resolve(),
      },
    }),
  }),
}));

vi.mock("../../src/env", () => ({ default: { ENCRYPTION_KEY: "0".repeat(64) } }));
vi.mock("../../src/context", () => ({
  flushDrainRegistry: { register: (): null => null },
  database: harness.database,
  flushDatabase: harness.database,
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: {
    call: () => Promise.resolve("OK"),
    del: () => Promise.resolve(1),
    eval: () => Promise.resolve([0, 0]),
    get: () => Promise.resolve(null),
    zmscore: () => Promise.resolve([]),
  },
  refreshLockStore: { release: () => Promise.resolve(), tryAcquire: () => Promise.resolve(true) },
}));
vi.mock("../../src/utils/logging", () => ({
  context: (callback: () => unknown) => callback(),
  widelog: {
    append: () => null,
    count: () => null,
    error: () => null,
    errorFields: () => null,
    flush: () => null,
    max: () => null,
    min: () => null,
    set: () => null,
    setFields: () => null,
    time: { measure: (_key: string, callback: () => unknown) => callback() },
  },
}));
vi.mock("../../src/utils/enqueue-destination-syncs", () => ({
  enqueueDestinationSyncsForUsers: () => Promise.resolve(0),
}));

const WINDOW_RECORDED_AT = new Date("2026-01-01T00:00:00.000Z");
const TOKEN_EXPIRY_MS = 3_600_000;
const BACKOFF_WINDOW_MS = 600_000;
const FAILURE_COUNT = 3;
const STORED_EVENT_COUNT = 7;

const commonCalendarFields = {
  ingestFutureRange: "6m",
  ingestHistoricRange: "1m",
  ingestWindowEnd: null,
  ingestWindowRecordedAt: WINDOW_RECORDED_AT,
  ingestWindowStart: null,
  nextAttemptAt: null,
  storedEventCount: STORED_EVENT_COUNT,
};

const oauthListingRow = {
  accountId: "account-oauth",
  calendarId: "calendar-oauth",
  externalCalendarId: "listing-external-id",
  oauthCredentialId: "credential-oauth",
  provider: "outlook",
  reauthenticationSource: null,
  syncToken: null,
  userId: "user-oauth",
  ...commonCalendarFields,
};

const oauthCalendarRow = {
  ...commonCalendarFields,
  accessToken: "merged-access-token",
  accountId: "account-oauth",
  expiresAt: new Date(Date.now() + TOKEN_EXPIRY_MS),
  externalCalendarId: "merged-external-id",
  failureCount: FAILURE_COUNT,
  oauthCredentialId: "credential-oauth",
  provider: "outlook",
  refreshToken: "merged-refresh-token",
  syncToken: null,
  userId: "user-oauth",
};

const caldavListingRow = {
  accountId: "account-caldav",
  calendarId: "calendar-caldav",
  calendarUrl: "https://dav.example.com/listing/",
  encryptedPassword: "cipher",
  provider: "caldav",
  reauthenticationSource: null,
  serverUrl: "https://dav.example.com/",
  userId: "user-caldav",
  username: "dav-user",
  ...commonCalendarFields,
};

const caldavCalendarRow = {
  ...commonCalendarFields,
  accountId: "account-caldav",
  calendarUrl: "https://dav.example.com/merged/",
  encryptedPassword: "cipher",
  failureCount: FAILURE_COUNT,
  provider: "caldav",
  serverUrl: "https://dav.example.com/",
  userId: "user-caldav",
  username: "dav-user",
};

const icsListingRow = {
  calendarId: "calendar-ics",
  treatFullDayTimedEventsAsAllDay: false,
  url: "https://feeds.example.net/listing.ics",
  userId: "user-ics",
  ...commonCalendarFields,
};

const icsCalendarRow = {
  ...commonCalendarFields,
  failureCount: FAILURE_COUNT,
  treatFullDayTimedEventsAsAllDay: false,
  url: "https://feeds.example.net/merged.ics",
  userId: "user-ics",
};

const families = [
  {
    calendarRow: oauthCalendarRow,
    fetches: (): Record<string, unknown>[] => harness.state.oauthFetcherOptions,
    listing: (): Record<string, unknown>[] => harness.state.oauthRows,
    listingRow: oauthListingRow,
    name: "oauth",
  },
  {
    calendarRow: caldavCalendarRow,
    fetches: (): Record<string, unknown>[] => harness.state.caldavFetcherOptions,
    listing: (): Record<string, unknown>[] => harness.state.caldavRows,
    listingRow: caldavListingRow,
    name: "caldav",
  },
  {
    calendarRow: icsCalendarRow,
    fetches: (): Record<string, unknown>[] => harness.state.icsFetcherOptions,
    listing: (): Record<string, unknown>[] => harness.state.icsRows,
    listingRow: icsListingRow,
    name: "ics",
  },
];

let job: typeof ingestSourcesJob | null = null;

beforeAll(async () => {
  const module = await import("../../src/jobs/ingest-sources");
  job = module.default;
});

beforeEach(() => {
  harness.state.caldavFetcherOptions.length = 0;
  harness.state.caldavRows.length = 0;
  harness.state.calendarRow = null;
  harness.state.icsFetcherOptions.length = 0;
  harness.state.icsRows.length = 0;
  harness.state.oauthFetcherOptions.length = 0;
  harness.state.oauthRows.length = 0;
});

describe.each(families)(
  "$name backoff gate",
  ({ calendarRow, fetches, listing, listingRow }) => {
    it("performs no provider fetch while the next attempt is in the future", async () => {
      listing().push(listingRow);
      harness.state.calendarRow = {
        ...calendarRow,
        nextAttemptAt: new Date(Date.now() + BACKOFF_WINDOW_MS),
      };

      await job?.callback();

      expect(fetches()).toHaveLength(0);
    });

    it("performs no provider fetch when the calendar row is gone", async () => {
      listing().push(listingRow);
      harness.state.calendarRow = null;

      await job?.callback();

      expect(fetches()).toHaveLength(0);
    });

    it("performs the provider fetch once the calendar is out of backoff", async () => {
      listing().push(listingRow);
      harness.state.calendarRow = calendarRow;

      await job?.callback();

      expect(fetches()).toHaveLength(1);
    });
  },
);
