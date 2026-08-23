import { encryptPassword } from "@keeper.sh/database";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

const CALENDAR_URL = "https://caldav.example.net/calendars/user-1/personal/";

const harness = vi.hoisted(() => {
  interface CalDAVSourceRow {
    accountId: string;
    calendarId: string;
    calendarUrl: string;
    encryptedPassword: string;
    ingestFutureRange: string;
    ingestHistoricRange: string;
    ingestWindowRecordedAt: Date | null;
    provider: string;
    reauthenticationSource: string | null;
    serverUrl: string;
    userId: string;
  }

  const state = {
    acquiredPermits: [] as number[],
    caldavRows: [] as CalDAVSourceRow[],
    accountFactoryIds: [] as string[],
    hostFactoryHosts: [] as string[],
    providerRequests: [] as string[],
  };

  const storedIngestSeq = 0;

  const ingestSeqRows = (): unknown[] => [{ ingestSeq: storedIngestSeq }];

  /* Grouped as properties so vi.hoisted can own capture-free helpers. */
  const helpers = {
    buildICalendarObject: (index: number): string => [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//keeper-test//EN",
      "BEGIN:VEVENT",
      `UID:event-${index}`,
      "DTSTAMP:20260810T000000Z",
      "DTSTART:20260820T100000Z",
      "DTEND:20260820T110000Z",
      "SUMMARY:Event",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n"),
    renderStatementText: (statement: unknown): string => {
      const collected: string[] = [];
      const seen = new Set<object>();
      const visit = (node: unknown): void => {
        if (typeof node === "string") {
          collected.push(node);
          return;
        }
        if (!node || typeof node !== "object") {
          return;
        }
        if (seen.has(node)) {
          return;
        }
        seen.add(node);
        for (const child of Object.values(node)) {
          visit(child);
        }
      };
      visit(statement);
      return collected.join(" ");
    },
    resolveBare: (fields: Record<string, unknown>): unknown[] => {
      if ("count" in fields) {
        return [{ count: 10 }];
      }
      return [];
    },
    transactionRunner: async (
      callback: (transaction: unknown) => Promise<unknown>,
    ): Promise<unknown> => await callback({
      execute: (): Promise<unknown[]> => Promise.resolve([]),
      select: (fields: Record<string, unknown>) => ({
        from: () => ({
          where: () => {
            const resolveRows = (): unknown[] => {
              if ("ingestSeq" in fields) {
                return ingestSeqRows();
              }
              return [];
            };
            return Object.assign(Promise.resolve(resolveRows()), {
              limit: () => Promise.resolve(resolveRows()),
            });
          },
        }),
      }),
    }),
  };

  const containsCalendarId = (node: unknown, calendarId: string): boolean =>
    helpers.renderStatementText(node).includes(calendarId);

  const resolveLimited = (fields: Record<string, unknown>, predicate: unknown): unknown[] => {
    if ("encryptedPassword" in fields) {
      const row = state.caldavRows.find(
        (candidate) => containsCalendarId(predicate, candidate.calendarId),
      );
      if (!row) {
        return [];
      }
      return [{ failureCount: 0, ingestSeq: storedIngestSeq, nextAttemptAt: null, ...row }];
    }
    return [];
  };

  const resolveListing = (fields: Record<string, unknown>): unknown[] => {
    if ("encryptedPassword" in fields) {
      return state.caldavRows;
    }
    return [];
  };

  const createQueryBuilder = (fields: Record<string, unknown>) => {
    const builder: Record<string, unknown> = {};
    const chain = (): unknown => builder;
    builder.from = chain;
    builder.innerJoin = chain;
    builder.leftJoin = chain;
    builder.where = (predicate: unknown) =>
      Object.assign(Promise.resolve(helpers.resolveBare(fields)), {
        limit: () => Promise.resolve(resolveLimited(fields, predicate)),
        orderBy: () => Promise.resolve(resolveListing(fields)),
      });
    return builder;
  };

  const updateBuilder = {
    set: () => ({
      where: () => Object.assign(Promise.resolve([]), {
        returning: () => Promise.resolve([]),
      }),
    }),
  };

  const fakeDatabase = {
    select: (fields: Record<string, unknown>) => createQueryBuilder(fields),
    transaction: helpers.transactionRunner,
    update: () => updateBuilder,
  };

  const createCalDAVAccountRateLimiter = vi.fn((_redis: unknown, accountId: string) => {
    state.accountFactoryIds.push(accountId);
    return {
      acquire: (weight: number): Promise<void> => {
        state.acquiredPermits.push(weight);
        return Promise.resolve();
      },
    };
  });

  const createHostRateLimiter = vi.fn((_redis: unknown, host: string) => {
    state.hostFactoryHosts.push(host);
    return {
      acquire: (weight: number): Promise<void> => {
        state.acquiredPermits.push(weight);
        return Promise.resolve();
      },
    };
  });

  interface FakeIngestSourceOptions {
    calendarId: string;
    fetchEvents: () => Promise<unknown>;
    withPersistenceTransaction: (
      work: (persistence: unknown) => Promise<{ eventsAdded: number; eventsRemoved: number }>,
    ) => Promise<{ eventsAdded: number; eventsRemoved: number }>;
  }

  const ingestSource = vi.fn(async (
    options: FakeIngestSourceOptions,
  ): Promise<{ eventsAdded: number; eventsRemoved: number }> => {
    await options.fetchEvents();
    return await options.withPersistenceTransaction(
      () => Promise.resolve({ eventsAdded: 0, eventsRemoved: 0 }),
    );
  });

  const calendarUrl = "https://caldav.example.net/calendars/user-1/personal/";
  const objectPaths = Array.from(
    { length: 251 },
    (_unused, index) => `/calendars/user-1/personal/event-${index}.ics`,
  );

  const buildFakeDAVClient = (
    sendOriginRequest: (label: string) => Promise<void>,
  ): Record<string, (params: never) => Promise<unknown>> => ({
    calendarQuery: async (): Promise<{ href: string }[]> => {
      await sendOriginRequest("calendar-query");
      return objectPaths.map((path) => ({ href: path }));
    },
    fetchCalendarObjects: async (params: { objectUrls: string[] }): Promise<unknown[]> => {
      await sendOriginRequest(`multiget:${params.objectUrls.length}`);
      return params.objectUrls.map((url, index) => ({
        data: helpers.buildICalendarObject(index),
        url,
      }));
    },
    fetchCalendars: async (): Promise<unknown[]> => {
      await sendOriginRequest("propfind-calendars");
      return [{
        components: ["VEVENT"],
        ctag: "ctag-1",
        displayName: "Personal",
        url: calendarUrl,
      }];
    },
  }) as unknown as Record<string, (params: never) => Promise<unknown>>;

  return {
    buildFakeDAVClient,
    createCalDAVAccountRateLimiter,
    createHostRateLimiter,
    fakeDatabase,
    ingestSource,
    state,
  };
});

vi.mock("tsdav", () => ({
  DAVNamespaceShort: { DAV: "d" },
  /*
   * Real tsdav sends every operation through the fetch it was constructed
   * with; the fake must too, because the host-limiter charge lives there.
   */
  createDAVClient: (options: { fetch: typeof globalThis.fetch }) =>
    Promise.resolve(harness.buildFakeDAVClient(async (label: string) => {
      harness.state.providerRequests.push(label);
      await options.fetch(CALENDAR_URL, { method: "REPORT" });
    })),
}));

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createCalDAVAccountRateLimiter: harness.createCalDAVAccountRateLimiter,
    createHostRateLimiter: harness.createHostRateLimiter,
    ingestSource: harness.ingestSource,
  };
});

vi.mock("@keeper.sh/sync", () => ({
  createSyncLock: () => ({
    acquire: () => Promise.resolve({
      acquired: true,
      handle: {
        isCurrent: () => Promise.resolve(true),
        release: () => Promise.resolve(),
      },
    }),
  }),
}));

/* A real key so the job's decryptPassword round-trips the fixture password. */
const ENCRYPTION_KEY = Buffer.alloc(32).toString("base64");

vi.mock("../../src/env", () => ({
  default: { ENCRYPTION_KEY: Buffer.alloc(32).toString("base64") },
}));
vi.mock("../../src/context", () => ({
  flushDrainRegistry: { register: (): null => null },
  database: harness.fakeDatabase,
  flushDatabase: harness.fakeDatabase,
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: {
    eval: () => Promise.resolve(null),
    get: () => Promise.resolve(null),
    setex: () => Promise.resolve("OK"),
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

let job: typeof ingestSourcesJob | null = null;

let originalFetch: typeof globalThis.fetch = globalThis.fetch;

beforeAll(async () => {
  const module = await import("../../src/jobs/ingest-sources");
  job = module.default;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  /* The fake tsdav client's requests must terminate here, never on the network. */
  originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response("", { status: 207 }))) as unknown as typeof globalThis.fetch;
  harness.state.acquiredPermits.length = 0;
  harness.state.caldavRows.length = 0;
  harness.state.accountFactoryIds.length = 0;
  harness.state.hostFactoryHosts.length = 0;
  harness.state.providerRequests.length = 0;
  harness.createHostRateLimiter.mockClear();
  harness.ingestSource.mockClear();
});

describe("CalDAV limiter consumption", () => {
  it("draws one account permit per origin request across a multi-batch fetch", async () => {
    harness.state.caldavRows.push({
      accountId: "account-caldav-1",
      calendarId: "calendar-caldav-1",
      calendarUrl: CALENDAR_URL,
      encryptedPassword: encryptPassword("secret", ENCRYPTION_KEY),
      ingestFutureRange: "6m",
      ingestHistoricRange: "1m",
      ingestWindowRecordedAt: new Date(),
      provider: "fastmail",
      reauthenticationSource: null,
      serverUrl: "https://caldav.example.net",
      userId: "user-1",
    });

    await job?.callback();

    expect(harness.state.accountFactoryIds).toEqual(["account-caldav-1"]);
    expect(harness.state.hostFactoryHosts).toEqual([]);

    // 251 objects: a discovery PROPFIND, a calendar-query, then ceil(251 / 250) multigets.
    expect(harness.state.providerRequests).toEqual([
      "propfind-calendars",
      "calendar-query",
      "multiget:250",
      "multiget:1",
    ]);

    let chargedPermits = 0;
    for (const weight of harness.state.acquiredPermits) {
      chargedPermits += weight;
    }
    expect(chargedPermits).toBeGreaterThanOrEqual(harness.state.providerRequests.length);
  });

  it("charges a self-hosted server's own host budget rather than an account budget", async () => {
    harness.state.caldavRows.push({
      accountId: "account-caldav-2",
      calendarId: "calendar-caldav-2",
      calendarUrl: CALENDAR_URL,
      encryptedPassword: encryptPassword("secret", ENCRYPTION_KEY),
      ingestFutureRange: "6m",
      ingestHistoricRange: "1m",
      ingestWindowRecordedAt: new Date(),
      provider: "caldav",
      reauthenticationSource: null,
      serverUrl: "https://caldav.example.net",
      userId: "user-1",
    });

    await job?.callback();

    expect(harness.state.hostFactoryHosts).toEqual(["caldav.example.net"]);
    expect(harness.state.accountFactoryIds).toEqual([]);

    let chargedPermits = 0;
    for (const weight of harness.state.acquiredPermits) {
      chargedPermits += weight;
    }
    expect(chargedPermits).toBeGreaterThanOrEqual(harness.state.providerRequests.length);
  });
});
