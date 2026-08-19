import { encryptPassword } from "@keeper.sh/database";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type ingestSourcesJob from "../../src/jobs/ingest-sources";

/*
 * Pins the host rate limiter to the unit it is defined over on the CalDAV
 * family: the shared per-host budget meters requests per minute, so a CalDAV
 * ingest must draw one permit for every request it sends to the origin. The
 * real CalDAV fetcher issues one calendar-query REPORT plus one multiget
 * REPORT per 250-object batch (on top of discovery), so a run over a large
 * calendar that charges the limiter a single permit undercounts real origin
 * traffic and lets an unthrottled request herd through.
 *
 * The real createCalDAVSourceFetcher and CalDAVClient run here (including the
 * genuine 250-path batching); only tsdav is faked, so every fake client call
 * marks exactly one origin HTTP request.
 */
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
    hostFactoryHosts: [] as string[],
    providerRequests: [] as string[],
  };

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
    }),
  };

  const containsCalendarId = (node: unknown, calendarId: string): boolean =>
    helpers.renderStatementText(node).includes(calendarId);

  const resolveLimited = (fields: Record<string, unknown>, predicate: unknown): unknown[] => {
    if ("failureCount" in fields) {
      return [{ failureCount: 0, nextAttemptAt: null }];
    }
    if ("encryptedPassword" in fields) {
      const row = state.caldavRows.find(
        (candidate) => containsCalendarId(predicate, candidate.calendarId),
      );
      if (!row) {
        return [];
      }
      return [row];
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

  /*
   * The engine is not under test: fetch, then route the result through the
   * job-provided persistence transaction, exactly like the real ingestSource.
   */
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

  /* One fake tsdav client call per origin HTTP request. */
  const fakeDAVClient = {
    calendarQuery: (): Promise<{ href: string }[]> => {
      state.providerRequests.push("calendar-query");
      return Promise.resolve(objectPaths.map((path) => ({ href: path })));
    },
    fetchCalendarObjects: (params: { objectUrls: string[] }): Promise<unknown[]> => {
      state.providerRequests.push(`multiget:${params.objectUrls.length}`);
      return Promise.resolve(params.objectUrls.map((url, index) => ({
        data: helpers.buildICalendarObject(index),
        url,
      })));
    },
    fetchCalendars: (): Promise<unknown[]> => {
      state.providerRequests.push("propfind-calendars");
      return Promise.resolve([{
        components: ["VEVENT"],
        ctag: "ctag-1",
        displayName: "Personal",
        url: calendarUrl,
      }]);
    },
  };

  return { createHostRateLimiter, fakeDatabase, fakeDAVClient, ingestSource, state };
});

vi.mock("tsdav", () => ({
  DAVNamespaceShort: { DAV: "d" },
  createDAVClient: () => Promise.resolve(harness.fakeDAVClient),
}));

vi.mock("@keeper.sh/calendar", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
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
  database: harness.fakeDatabase,
  flushDatabase: harness.fakeDatabase,
  premiumService: { getUserPlan: () => Promise.resolve("pro") },
  refreshLockRedis: { eval: () => Promise.resolve(null), get: () => Promise.resolve(null) },
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

beforeAll(async () => {
  const module = await import("../../src/jobs/ingest-sources");
  job = module.default;
});

beforeEach(() => {
  harness.state.acquiredPermits.length = 0;
  harness.state.caldavRows.length = 0;
  harness.state.hostFactoryHosts.length = 0;
  harness.state.providerRequests.length = 0;
  harness.createHostRateLimiter.mockClear();
  harness.ingestSource.mockClear();
});

describe("CalDAV host limiter consumption", () => {
  it("draws one host permit per origin request across a multi-batch fetch", async () => {
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

    /* The ingest resolved the shared limiter keyed by the CalDAV host. */
    expect(harness.state.hostFactoryHosts).toEqual(["caldav.example.net"]);

    /*
     * The real client listed 251 objects: one calendar-query REPORT plus
     * ceil(251 / 250) = 2 multiget REPORTs, on top of one discovery PROPFIND.
     */
    expect(harness.state.providerRequests).toEqual([
      "propfind-calendars",
      "calendar-query",
      "multiget:250",
      "multiget:1",
    ]);

    /*
     * The limiter budget is requests per minute per host, so the run must be
     * charged at least one permit per request it actually sent to the origin.
     */
    let chargedPermits = 0;
    for (const weight of harness.state.acquiredPermits) {
      chargedPermits += weight;
    }
    expect(chargedPermits).toBeGreaterThanOrEqual(harness.state.providerRequests.length);
  });
});
