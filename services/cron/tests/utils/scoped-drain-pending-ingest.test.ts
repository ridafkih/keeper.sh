import { describe, expect, it, vi } from "vitest";
import {
  PENDING_CORRELATION_KEY,
  PENDING_INGEST_KEY,
  PENDING_REWAKE_KEY,
} from "@keeper.sh/calendar";
import { runDrainPendingIngest } from "../../src/utils/drain-pending-ingest";
import { createScopedClaimPending } from "../../src/utils/scoped-drain-pending-ingest";

const NOW_MS = new Date("2026-08-18T00:00:00.000Z").getTime();
const DELIVERED_REWAKE = "1";

interface PendingFixture {
  correlationIds: Map<string, string>;
  scores: Map<string, number>;
}

const createFakeRedis = (fixture: PendingFixture) => {
  const reserved = new Set<string>();
  return {
    del: vi.fn((...keys: string[]) => {
      for (const key of keys) {
        reserved.delete(key);
      }
      return Promise.resolve(keys.length);
    }),
    hmget: vi.fn((key: string, ...members: string[]) => {
      if (key === PENDING_REWAKE_KEY) {
        return Promise.resolve(members.map((member) => {
          if (fixture.scores.has(member)) {
            return DELIVERED_REWAKE;
          }
          return null;
        }));
      }
      expect(key).toBe(PENDING_CORRELATION_KEY);
      return Promise.resolve(members.map((member) => fixture.correlationIds.get(member) ?? null));
    }),
    hsetnx: vi.fn(() => Promise.resolve(0)),
    set: vi.fn((key: string) => {
      if (reserved.has(key)) {
        return Promise.resolve(null);
      }
      reserved.add(key);
      return Promise.resolve("OK");
    }),
    zscore: vi.fn((key: string, member: string) => {
      expect(key).toBe(PENDING_INGEST_KEY);
      if (!fixture.scores.has(member)) {
        return Promise.resolve(null);
      }
      return Promise.resolve(String(fixture.scores.get(member)));
    }),
  };
};

const makeDependencies = (
  fixture: PendingFixture,
  scopedIds: string[],
  overrides: Record<string, unknown> = {},
) => ({
  claimPending: createScopedClaimPending(createFakeRedis(fixture), scopedIds),
  countPending: vi.fn(() => Promise.resolve(fixture.scores.size)),
  enabled: true,
  enqueueDestinationSyncs: vi.fn(() => Promise.resolve()),
  ingestCalendars: vi.fn(() => Promise.resolve({ affectedUserIds: ["user-1"] })),
  now: () => new Date(NOW_MS + 1000),
  observe: vi.fn(),
  recordError: vi.fn(),
  recordFailures: vi.fn((calendarIds: string[]) =>
    Promise.resolve(Object.fromEntries(calendarIds.map((calendarId) => [calendarId, 1])))),
  releaseAbandoned: vi.fn(() => Promise.resolve()),
  releaseClaims: vi.fn(() => Promise.resolve()),
  releasePending: vi.fn((members: { calendarId: string; score: number }[]) =>
    Promise.resolve(members.map((member) => member.calendarId))),
  resolveCalendars: vi.fn((calendarIds: string[]) =>
    Promise.resolve(calendarIds.map((calendarId) => ({ calendarId, userId: "user-1" })))),
  resolvePlan: vi.fn(() => Promise.resolve("pro" as const)),
  ...overrides,
});

const releasedCalendarIds = (releasePending: ReturnType<typeof vi.fn>): string[] =>
  releasePending.mock.calls.flatMap(([members]) =>
    (members as { calendarId: string }[]).map((member) => member.calendarId));

describe("scoped drain claims only the named calendars", () => {
  it("ingests the named calendars and leaves the rest of the pending set alone", async () => {
    const fixture: PendingFixture = {
      correlationIds: new Map([["cal-a", "corr-a"], ["cal-c", "corr-c"]]),
      scores: new Map([["cal-a", NOW_MS], ["cal-b", NOW_MS], ["cal-c", NOW_MS]]),
    };
    const dependencies = makeDependencies(fixture, ["cal-a", "cal-c"]);

    await runDrainPendingIngest(dependencies);

    expect(dependencies.ingestCalendars.mock.calls).toEqual([
      [["cal-a"], { "cal-a": "corr-a" }],
      [["cal-c"], { "cal-c": "corr-c" }],
    ]);
    expect(releasedCalendarIds(dependencies.releasePending)).not.toContain("cal-b");
  });

  it("skips a named id that is no longer pending", async () => {
    const fixture: PendingFixture = {
      correlationIds: new Map([["cal-a", "corr-a"]]),
      scores: new Map([["cal-a", NOW_MS]]),
    };
    const dependencies = makeDependencies(fixture, ["cal-a", "cal-drained"]);

    await runDrainPendingIngest(dependencies);

    expect(dependencies.ingestCalendars).toHaveBeenCalledWith(["cal-a"], { "cal-a": "corr-a" });
    expect(releasedCalendarIds(dependencies.releasePending)).not.toContain("cal-drained");
  });

  it("carries the current pending score rather than the score at signal time", async () => {
    const rewokenScore = NOW_MS + 4000;
    const fixture: PendingFixture = {
      correlationIds: new Map([["cal-a", "corr-a"]]),
      scores: new Map([["cal-a", rewokenScore]]),
    };
    const dependencies = makeDependencies(fixture, ["cal-a"]);

    await runDrainPendingIngest(dependencies);

    expect(dependencies.releasePending).toHaveBeenCalledWith([
      {
        calendarId: "cal-a",
        correlationId: "corr-a",
        rewake: DELIVERED_REWAKE,
        score: rewokenScore,
      },
    ]);
  });

  it("releases a free-plan calendar named directly instead of ingesting it", async () => {
    const fixture: PendingFixture = {
      correlationIds: new Map([["cal-free", "corr-free"], ["cal-pro", "corr-pro"]]),
      scores: new Map([["cal-free", NOW_MS], ["cal-pro", NOW_MS]]),
    };
    const dependencies = makeDependencies(fixture, ["cal-free", "cal-pro"], {
      resolveCalendars: vi.fn(() => Promise.resolve([
        { calendarId: "cal-free", userId: "free-user" },
        { calendarId: "cal-pro", userId: "pro-user" },
      ])),
      resolvePlan: vi.fn((userId: string) => {
        if (userId === "pro-user") {
          return Promise.resolve("pro" as const);
        }
        return Promise.resolve("free" as const);
      }),
    });

    await runDrainPendingIngest(dependencies);

    expect(dependencies.ingestCalendars).toHaveBeenCalledWith(["cal-pro"], { "cal-pro": "corr-pro" });
    expect(releasedCalendarIds(dependencies.releasePending)).toContain("cal-free");
  });
});
