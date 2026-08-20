import { describe, expect, it, vi } from "vitest";
import { MAX_PENDING_FAILURES, runDrainPendingIngest } from "../../src/utils/drain-pending-ingest";

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

const releasedCalendarIds = (calls: unknown[][]): string[] =>
  calls.flatMap((call) => (call[0] as { calendarId: string }[]).map((member) => member.calendarId));

const enqueuedUserIds = (calls: unknown[][]): string[] =>
  calls.flatMap((call) => call[0] as string[]);

const usersEnqueuedWithoutCorrelationId = (calls: unknown[][]): string[] =>
  calls.flatMap((call) => {
    const userIds = call[0] as string[];
    const correlationIdByUserId = call[1] as Record<string, string>;
    return userIds.filter((userId) => (correlationIdByUserId[userId] ?? "").length === 0);
  });

describe("incremental enqueue keeps release tied to its own ingest", () => {
  it("releases a member only once that member's ingest has completed", async () => {
    const fastIngest = createDeferred();
    const slowIngest = createDeferred();
    const gateByCalendarId = new Map<string, Deferred>([
      ["cal-fast", fastIngest],
      ["cal-slow", slowIngest],
    ]);
    const userIdByCalendarId: Record<string, string> = {
      "cal-fast": "user-fast",
      "cal-slow": "user-slow",
    };

    const dependencies = {
      claimPending: vi.fn(() =>
        Promise.resolve([
          { calendarId: "cal-fast", correlationId: "correlation-fast", score: NOW_MS },
          { calendarId: "cal-slow", correlationId: "correlation-slow", score: NOW_MS },
        ])),
      countPending: vi.fn(() => Promise.resolve(2)),
      enabled: true,
      enqueueDestinationSyncs: vi.fn(() => Promise.resolve()),
      ingestCalendars: vi.fn(async (calendarIds: string[]) => {
        await Promise.all(calendarIds.map((calendarId) => gateByCalendarId.get(calendarId)?.promise));
        return {
          affectedUserIds: calendarIds.map((calendarId) => userIdByCalendarId[calendarId] ?? ""),
        };
      }),
      now: () => new Date(NOW_MS + 1000),
      observe: vi.fn(),
      recordError: vi.fn(),
      recordFailures: vi.fn((calendarIds: string[]) =>
        Promise.resolve(Object.fromEntries(calendarIds.map((calendarId) => [calendarId, 1])))),
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
    expect(releasedCalendarIds(dependencies.releasePending.mock.calls)).toEqual([]);

    fastIngest.resolve();
    await flushMicrotasks();

    expect(releasedCalendarIds(dependencies.releasePending.mock.calls)).toContain("cal-fast");
    expect(releasedCalendarIds(dependencies.releasePending.mock.calls)).not.toContain("cal-slow");

    slowIngest.resolve();
    await drained;

    expect(releasedCalendarIds(dependencies.releasePending.mock.calls)).toContain("cal-slow");
  });
});

describe("incremental enqueue isolates a failing calendar", () => {
  it("enqueues the healthy sibling and still drives the failure and abandon paths", async () => {
    const dependencies = {
      claimPending: vi.fn(() =>
        Promise.resolve([
          { calendarId: "cal-bad", correlationId: "correlation-bad", score: NOW_MS },
          { calendarId: "cal-good", correlationId: "correlation-good", score: NOW_MS },
        ])),
      countPending: vi.fn(() => Promise.resolve(2)),
      enabled: true,
      enqueueDestinationSyncs: vi.fn(() => Promise.resolve()),
      ingestCalendars: vi.fn((calendarIds: string[]) => {
        if (calendarIds.includes("cal-bad")) {
          return Promise.reject(new Error("provider exploded"));
        }
        return Promise.resolve({ affectedUserIds: ["user-good"] });
      }),
      now: () => new Date(NOW_MS + 1000),
      observe: vi.fn(),
      recordError: vi.fn(),
      recordFailures: vi.fn((calendarIds: string[]) =>
        Promise.resolve(
          Object.fromEntries(
            calendarIds.map((calendarId) => [calendarId, MAX_PENDING_FAILURES]),
          ),
        )),
      releaseAbandoned: vi.fn(() => Promise.resolve()),
      releaseClaims: vi.fn(() => Promise.resolve()),
      releasePending: vi.fn((members: { calendarId: string }[]) =>
        Promise.resolve(members.map((member) => member.calendarId))),
      resolveCalendars: vi.fn(() =>
        Promise.resolve([
          { calendarId: "cal-bad", userId: "user-bad" },
          { calendarId: "cal-good", userId: "user-good" },
        ])),
      resolvePlan: vi.fn(() => Promise.resolve("pro" as const)),
    };

    await runDrainPendingIngest(dependencies);

    expect(enqueuedUserIds(dependencies.enqueueDestinationSyncs.mock.calls)).toContain("user-good");
    expect(enqueuedUserIds(dependencies.enqueueDestinationSyncs.mock.calls))
      .not.toContain("user-bad");
    expect(dependencies.recordError).toHaveBeenCalledTimes(1);
    expect(dependencies.recordFailures).toHaveBeenCalledWith(["cal-bad"]);
    expect(dependencies.releaseAbandoned).toHaveBeenCalledWith(["cal-bad"]);
    expect(releasedCalendarIds(dependencies.releasePending.mock.calls)).not.toContain("cal-bad");
  });
});

describe("incremental enqueue keeps the webhook correlation id attached", () => {
  it("carries a user's correlation id on every destination sync enqueued for that user", async () => {
    const dependencies = {
      claimPending: vi.fn(() =>
        Promise.resolve([
          { calendarId: "cal-plain", score: NOW_MS },
          { calendarId: "cal-tagged", correlationId: "correlation-tagged", score: NOW_MS },
        ])),
      countPending: vi.fn(() => Promise.resolve(2)),
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
      releasePending: vi.fn((members: { calendarId: string }[]) =>
        Promise.resolve(members.map((member) => member.calendarId))),
      resolveCalendars: vi.fn(() =>
        Promise.resolve([
          { calendarId: "cal-plain", userId: "user-1" },
          { calendarId: "cal-tagged", userId: "user-1" },
        ])),
      resolvePlan: vi.fn(() => Promise.resolve("pro" as const)),
    };

    await runDrainPendingIngest(dependencies);

    /*
     * BullMQ keeps the first job for a deterministic id and drops the later duplicate, so an
     * enqueue that omits the correlation id wins and the webhook trace is lost for good.
     */
    expect(usersEnqueuedWithoutCorrelationId(dependencies.enqueueDestinationSyncs.mock.calls))
      .toEqual([]);
  });
});
