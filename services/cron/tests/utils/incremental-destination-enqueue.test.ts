import { describe, expect, it, vi } from "vitest";
import { runDrainPendingIngest } from "../../src/utils/drain-pending-ingest";

const NOW_MS = new Date("2026-08-18T00:00:00.000Z").getTime();
const MICROTASK_FLUSH_TICKS = 200;

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

const noop = (): void => {
  // Replaced synchronously by the Promise executor.
};

const createDeferred = (): Deferred => {
  let settle: () => void = noop;
  const promise = new Promise<void>((resolve) => {
    settle = () => {
      resolve();
    };
  });
  return {
    promise,
    resolve: () => {
      settle();
    },
  };
};

const flushMicrotasks = async (): Promise<void> => {
  for (let tick = 0; tick < MICROTASK_FLUSH_TICKS; tick += 1) {
    await Promise.resolve();
  }
};

const USER_ID_BY_CALENDAR_ID: Record<string, string> = {
  "cal-fast": "user-fast",
  "cal-slow": "user-slow",
};

const enqueuedUserIds = (calls: unknown[][]): string[] =>
  calls.flatMap((call) => call[0] as string[]);

describe("a finished calendar does not wait for a slow sibling", () => {
  it("enqueues the fast calendar's destination sync while the slow ingest is still pending", async () => {
    const fastIngest = createDeferred();
    const slowIngest = createDeferred();
    const ingestGateByCalendarId = new Map<string, Deferred>([
      ["cal-fast", fastIngest],
      ["cal-slow", slowIngest],
    ]);

    const dependencies = {
      claimPending: vi.fn(() =>
        Promise.resolve([
          { calendarId: "cal-fast", correlationId: "correlation-fast", score: NOW_MS },
          { calendarId: "cal-slow", correlationId: "correlation-slow", score: NOW_MS },
        ])),
      countPending: vi.fn(() => Promise.resolve(2)),
      enabled: true,
      enqueueDestinationSyncs: vi.fn(
        (_userIds: string[], _correlationIdByUserId: Record<string, string>) =>
          Promise.resolve(),
      ),
      ingestCalendars: vi.fn(async (calendarIds: string[]) => {
        await Promise.all(
          calendarIds.map((calendarId) => ingestGateByCalendarId.get(calendarId)?.promise),
        );
        return {
          affectedUserIds: calendarIds.map((calendarId) =>
            USER_ID_BY_CALENDAR_ID[calendarId] ?? ""),
        };
      }),
      now: () => new Date(NOW_MS + 1000),
      observe: vi.fn(),
      recordError: vi.fn(),
      recordFailures: vi.fn((calendarIds: string[]) =>
        Promise.resolve(
          Object.fromEntries(calendarIds.map((calendarId) => [calendarId, 1])),
        )),
      releaseAbandoned: vi.fn(() => Promise.resolve()),
      releaseClaims: vi.fn(() => Promise.resolve()),
      releasePending: vi.fn((members: { calendarId: string }[]) =>
        Promise.resolve(members.map((member) => member.calendarId))),
      resolveCalendars: vi.fn(() =>
        Promise.resolve([
          { calendarId: "cal-fast", userId: "user-fast" },
          { calendarId: "cal-slow", userId: "user-slow" },
        ])),
      resolvePlan: vi.fn(() => Promise.resolve("pro" as const)),
    };

    const drained = runDrainPendingIngest(dependencies);

    await flushMicrotasks();
    expect(dependencies.ingestCalendars).toHaveBeenCalled();

    fastIngest.resolve();
    await flushMicrotasks();

    expect(enqueuedUserIds(dependencies.enqueueDestinationSyncs.mock.calls))
      .toContain("user-fast");
    expect(enqueuedUserIds(dependencies.enqueueDestinationSyncs.mock.calls))
      .not.toContain("user-slow");

    const fastCall = dependencies.enqueueDestinationSyncs.mock.calls.find((call) =>
      (call[0] as string[]).includes("user-fast"));
    expect(fastCall?.[1]).toMatchObject({ "user-fast": "correlation-fast" });

    slowIngest.resolve();
    await drained;

    expect(enqueuedUserIds(dependencies.enqueueDestinationSyncs.mock.calls))
      .toContain("user-slow");
  });
});
