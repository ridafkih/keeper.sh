import { describe, expect, it, vi } from "vitest";
import { runDrainPendingIngest } from "../../src/utils/drain-pending-ingest";
import { runEnqueueDestinationSyncsForUsers } from "../../src/utils/enqueue-destination-syncs-core";
import type {
  DestinationSyncQueue,
  EnqueueDestinationSyncDependencies,
} from "../../src/utils/enqueue-destination-syncs-core";
import type { PushDestinationJob } from "../../src/utils/push-destination-jobs";

const NOW_MS = new Date("2026-08-18T00:00:00.000Z").getTime();
const WOKEN_SOURCE_COUNT = 28;
const USER_ID = "user-1";
const DESTINATION_CALENDAR_ID = "dest-1";
const EXPECTED_JOB_ID = `sync-${USER_ID}-${DESTINATION_CALENDAR_ID}`;

const sourceCalendarIds = Array.from(
  { length: WOKEN_SOURCE_COUNT },
  (unused, index) => `cal-${index}`,
);

describe("one destination calendar does not fan out into many jobs", () => {
  it("builds one destination job for a user however many source calendars woke", async () => {
    const requestedJobs: PushDestinationJob[] = [];
    const liveJobIds = new Set<string>();

    /*
     * Models the BullMQ contract the deterministic id rests on: a job keeps its id while it is
     * queued or running, and a same-id enqueue arriving meanwhile comes back missing from the
     * addBulk result rather than as an error.
     */
    const queue: DestinationSyncQueue = {
      addBulk: (jobs: PushDestinationJob[]) => {
        requestedJobs.push(...jobs);
        const created = jobs.filter((job) => !liveJobIds.has(job.opts.jobId));
        for (const job of created) {
          liveJobIds.add(job.opts.jobId);
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
        Promise.resolve(sourceCalendarIds.map((calendarId, index) => ({
          calendarId,
          correlationId: `correlation-${index}`,
          score: NOW_MS + index,
        })))),
      countPending: vi.fn(() => Promise.resolve(WOKEN_SOURCE_COUNT)),
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
      ingestCalendars: vi.fn(() => Promise.resolve({ affectedUserIds: [USER_ID] })),
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
        Promise.resolve(sourceCalendarIds.map((calendarId) => ({ calendarId, userId: USER_ID })))),
      resolvePlan: vi.fn(() => Promise.resolve("pro" as const)),
    };

    await runDrainPendingIngest(dependencies);

    // Coalescing is the point: one destination calendar earns one destination job per drain.
    expect(requestedJobs).toHaveLength(1);
    expect(requestedJobs.map((job) => job.opts.jobId)).toEqual([EXPECTED_JOB_ID]);

    // The deterministic id the queue's first-enqueue invariant rests on stays intact.
    expect(liveJobIds).toEqual(new Set([EXPECTED_JOB_ID]));

    const [firstJob] = requestedJobs;
    expect(firstJob?.data.userId).toBe(USER_ID);
    expect(firstJob?.data.calendarId).toBe(DESTINATION_CALENDAR_ID);
    expect(firstJob?.data.trigger).toBe("push");
    expect(firstJob?.data.correlationId).toBe("correlation-0");
    expect(firstJob?.data.webhookReceivedAt).toBe(NOW_MS);
  });
});
