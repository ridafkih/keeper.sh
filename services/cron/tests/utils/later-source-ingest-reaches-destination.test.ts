import { describe, expect, it, vi } from "vitest";
import { runDrainPendingIngest } from "../../src/utils/drain-pending-ingest";
import { runEnqueueDestinationSyncsForUsers } from "../../src/utils/enqueue-destination-syncs-core";
import type {
  DestinationSyncQueue,
  EnqueueDestinationSyncDependencies,
} from "../../src/utils/enqueue-destination-syncs-core";
import type { PushDestinationJob } from "../../src/utils/push-destination-jobs";

const NOW_MS = new Date("2026-08-18T00:00:00.000Z").getTime();
const MICROTASK_FLUSH_TICKS = 200;

const USER_ID = "user-1";
const FAST_CALENDAR_ID = "cal-fast";
const SLOW_CALENDAR_ID = "cal-slow";
const DESTINATION_CALENDAR_ID = "dest-1";
const FAST_EVENT = "event-from-cal-fast";
const SLOW_EVENT = "event-from-cal-slow";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

interface SyncRun {
  jobId: string;
  sawEvents: string[];
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

describe("a later source ingest still reaches the destination", () => {
  it("runs a destination sync against the slow calendar's committed events", async () => {
    const fastIngest = createDeferred();
    const slowIngest = createDeferred();
    const ingestGateByCalendarId = new Map<string, Deferred>([
      [FAST_CALENDAR_ID, fastIngest],
      [SLOW_CALENDAR_ID, slowIngest],
    ]);
    const eventByCalendarId: Record<string, string> = {
      [FAST_CALENDAR_ID]: FAST_EVENT,
      [SLOW_CALENDAR_ID]: SLOW_EVENT,
    };

    const committedEvents: string[] = [];
    const syncRuns: SyncRun[] = [];
    const liveJobIds = new Set<string>();

    /*
     * Models the BullMQ contract the deterministic id rests on: a job keeps its id while it is
     * queued or running, a same-id enqueue arriving meanwhile is dropped, and the sync reads the
     * source rows committed at the moment it starts.
     */
    const queue: DestinationSyncQueue = {
      addBulk: (jobs: PushDestinationJob[]) => {
        const created = jobs.filter((job) => !liveJobIds.has(job.opts.jobId));
        for (const job of created) {
          liveJobIds.add(job.opts.jobId);
          syncRuns.push({ jobId: job.opts.jobId, sawEvents: [...committedEvents] });
        }
        return Promise.resolve(created);
      },
      close: () => Promise.resolve(),
      getJob: (jobId: string) => {
        if (liveJobIds.has(jobId)) {
          return Promise.resolve({ timestamp: NOW_MS });
        }
        return Promise.resolve(null);
      },
    };

    const enqueueDependencies: EnqueueDestinationSyncDependencies = {
      createQueue: () => queue,
      enabled: true,
      generateCorrelationId: () => "correlation-minted",
      getDestinations: () =>
        Promise.resolve([{ calendarId: DESTINATION_CALENDAR_ID, userId: USER_ID }]),
      resolvePlan: () => Promise.resolve("pro"),
    };

    const dependencies = {
      claimPending: vi.fn(() =>
        Promise.resolve([
          { calendarId: FAST_CALENDAR_ID, correlationId: "correlation-fast", score: NOW_MS },
          { calendarId: SLOW_CALENDAR_ID, correlationId: "correlation-slow", score: NOW_MS + 1 },
        ])),
      countPending: vi.fn(() => Promise.resolve(2)),
      enabled: true,
      enqueueDestinationSyncs: async (
        userIds: string[],
        correlationIdByUserId: Record<string, string>,
        webhookReceivedAtByUserId: Record<string, number>,
      ) => {
        await runEnqueueDestinationSyncsForUsers(
          userIds,
          enqueueDependencies,
          "push",
          correlationIdByUserId,
          webhookReceivedAtByUserId,
        );
      },
      ingestCalendars: vi.fn(async (calendarIds: string[]) => {
        await Promise.all(
          calendarIds.map((calendarId) => ingestGateByCalendarId.get(calendarId)?.promise),
        );
        for (const calendarId of calendarIds) {
          const event = eventByCalendarId[calendarId] ?? "";
          if (event.length > 0) {
            committedEvents.push(event);
          }
        }
        return { affectedUserIds: [USER_ID] };
      }),
      now: () => new Date(NOW_MS + 1000),
      observe: vi.fn(),
      recordError: vi.fn(),
      recordFailures: vi.fn((calendarIds: string[]) =>
        Promise.resolve(
          Object.fromEntries(calendarIds.map((calendarId) => [calendarId, 1])),
        )),
      releaseClaims: vi.fn(() => Promise.resolve()),
      releaseAbandoned: vi.fn(() => Promise.resolve()),
      releasePending: vi.fn((members: { calendarId: string }[]) =>
        Promise.resolve(members.map((member) => member.calendarId))),
      resolveCalendars: vi.fn(() =>
        Promise.resolve([
          { calendarId: FAST_CALENDAR_ID, userId: USER_ID },
          { calendarId: SLOW_CALENDAR_ID, userId: USER_ID },
        ])),
      resolvePlan: vi.fn(() => Promise.resolve("pro" as const)),
    };

    const drained = runDrainPendingIngest(dependencies);

    await flushMicrotasks();
    fastIngest.resolve();
    await flushMicrotasks();

    expect(committedEvents).toEqual([FAST_EVENT]);

    slowIngest.resolve();
    await drained;
    await flushMicrotasks();

    expect(committedEvents).toEqual([FAST_EVENT, SLOW_EVENT]);

    const eventsSyncedToDestination = syncRuns.flatMap((run) => run.sawEvents);
    expect(eventsSyncedToDestination).toContain(SLOW_EVENT);
  });
});
