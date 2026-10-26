import { describe, expect, it, vi } from "vitest";
import { DEFAULT_INGEST_INTERVAL_DIALS } from "@keeper.sh/calendar";
import type { IngestOutcome } from "@keeper.sh/calendar";
import type { ClaimedIngest, IngestCompletion } from "@keeper.sh/database";
import type { PushSyncTrigger } from "@keeper.sh/queue";
import { runIngestRound } from "../../src/ingest/run-ingest-round";
import type { IngestRoundDependencies } from "../../src/ingest/run-ingest-round";
import type {
  IngestRunOptions,
  IngestionBatchResult,
  SourceCalendarsIngestion,
} from "../../src/ingest/ingest-sources";
import type { IngestScheduleContext } from "../../src/ingest/schedule-context";
import type { IngestLane } from "../../src/utils/ingest-lanes";

vi.mock("../../src/utils/ingest-lanes", () => ({}));

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const claim = (overrides: Partial<ClaimedIngest> = {}): ClaimedIngest => ({
  calendarId: "calendar-1",
  claimedDueAt: new Date("2026-10-26T12:00:00.000Z"),
  failureCount: 0,
  lagMs: 1000,
  leaseToken: "00000000-0000-4000-8000-00000000aaaa",
  releaseSeq: 0,
  userId: "user-1",
  wakeCorrelationId: null,
  wakeDueAt: null,
  wakeReceivedAt: null,
  wakeSeq: 0,
  ...overrides,
});

const emptyResult = (overrides: Partial<IngestionBatchResult> = {}): IngestionBatchResult => ({
  abortedCalendarIds: [],
  added: 0,
  affectedUserIds: [],
  errors: 0,
  firstIngestUserIds: [],
  outcomes: [],
  removed: 0,
  ...overrides,
});

const ingested = (result: IngestionBatchResult): Promise<SourceCalendarsIngestion> =>
  Promise.resolve({ failures: [], result });

const outcomesFor = (entries: Record<string, IngestOutcome>): IngestionBatchResult["outcomes"] =>
  Object.entries(entries).map(([calendarId, outcome]) => ({ calendarId, outcome }));

interface EnqueueCall {
  correlationIdByUserId: Record<string, string>;
  trigger: PushSyncTrigger;
  userIds: string[];
  webhookReceivedAtByUserId: Record<string, number>;
}

interface Harness {
  completions: IngestCompletion[];
  dependencies: IngestRoundDependencies;
  enqueued: EnqueueCall[];
  errors: string[];
  events: string[];
  ingestCalls: { calendarIds: string[]; options: IngestRunOptions }[];
  observed: Record<string, number | string>[];
}

const resources = { name: "push-lane" } as unknown as IngestLane;

const createHarness = (overrides: Partial<IngestRoundDependencies> = {}): Harness => {
  const harness: Harness = {
    completions: [],
    dependencies: {} as IngestRoundDependencies,
    enqueued: [],
    errors: [],
    events: [],
    ingestCalls: [],
    observed: [],
  };
  harness.dependencies = {
    completeIngests: (completions) => {
      harness.events.push("complete");
      harness.completions.push(...completions);
      return Promise.resolve(completions.map(({ calendarId }) => calendarId));
    },
    dials: DEFAULT_INGEST_INTERVAL_DIALS,
    enqueueDestinationSyncs: (userIds, trigger, correlationIdByUserId, webhookReceivedAtByUserId) => {
      harness.events.push("enqueue");
      harness.enqueued.push({ correlationIdByUserId, trigger, userIds, webhookReceivedAtByUserId });
      return Promise.resolve();
    },
    ingestCalendars: (calendarIds, options) => {
      harness.ingestCalls.push({ calendarIds, options });
      return ingested(emptyResult({
        outcomes: calendarIds.map((calendarId) => ({ calendarId, outcome: { kind: "ingested" } })),
      }));
    },
    observe: (fields) => {
      harness.observed.push(fields);
    },
    random: () => 0,
    recordError: (_error, slug) => {
      harness.errors.push(slug);
    },
    recordFirstIngestSyncRequests: () => {
      harness.events.push("first-ingest");
      return Promise.resolve();
    },
    resolveScheduleContexts: (calendarIds) => Promise.resolve(new Map(calendarIds.map(
      (calendarId): [string, IngestScheduleContext] => [
        calendarId,
        { dormant: false, plan: "free", pushHealthy: false },
      ],
    ))),
    resources,
    ...overrides,
  };
  return harness;
};

const completionFor = (harness: Harness, calendarId: string): IngestCompletion => {
  const completion = harness.completions.find((entry) => entry.calendarId === calendarId);
  if (!completion) {
    throw new Error(`no completion was written for ${calendarId}`);
  }
  return completion;
};

describe("runIngestRound schedule writes", () => {
  it("writes one completion per claim from its outcome, failure count and interval", async () => {
    const harness = createHarness({
      ingestCalendars: () => ingested(emptyResult({
        outcomes: outcomesFor({
          "calendar-failed": { backoff: true, kind: "failed" },
          "calendar-ok": { kind: "ingested" },
        }),
      })),
    });

    await runIngestRound("fleet", [
      claim({ calendarId: "calendar-ok", leaseToken: "lease-ok", wakeSeq: 3 }),
      claim({ calendarId: "calendar-failed", failureCount: 2, leaseToken: "lease-failed" }),
      claim({ calendarId: "calendar-gone", leaseToken: "lease-gone" }),
    ], harness.dependencies);

    expect(completionFor(harness, "calendar-ok")).toEqual({
      attempted: true,
      calendarId: "calendar-ok",
      claimedReleaseSeq: 0,
      claimedWakeSeq: 3,
      failed: false,
      failureCount: 0,
      leaseToken: "lease-ok",
      nextDueInMs: 10 * MINUTE_MS,
      parkedReason: null,
      succeeded: true,
    });
    expect(completionFor(harness, "calendar-failed")).toMatchObject({
      failureCount: 3,
      leaseToken: "lease-failed",
      nextDueInMs: 20 * MINUTE_MS,
    });
    expect(completionFor(harness, "calendar-gone")).toMatchObject({
      nextDueInMs: HOUR_MS,
      parkedReason: "unresolvable",
    });
  });

  it("schedules each calendar on the interval its plan and push health call for", async () => {
    const contexts = new Map<string, IngestScheduleContext>([
      ["calendar-pro", { dormant: false, plan: "pro", pushHealthy: false }],
      ["calendar-pro-push", { dormant: false, plan: "pro", pushHealthy: true }],
      ["calendar-free-push", { dormant: false, plan: "free", pushHealthy: true }],
      ["calendar-dormant", { dormant: true, plan: "free", pushHealthy: false }],
    ]);
    const harness = createHarness({ resolveScheduleContexts: () => Promise.resolve(contexts) });

    await runIngestRound("fleet", [...contexts.keys()].map((calendarId) => claim({ calendarId })), harness.dependencies);

    expect(completionFor(harness, "calendar-pro").nextDueInMs).toBe(MINUTE_MS);
    expect(completionFor(harness, "calendar-pro-push").nextDueInMs).toBe(5 * MINUTE_MS);
    expect(completionFor(harness, "calendar-free-push").nextDueInMs).toBe(HOUR_MS);
    expect(completionFor(harness, "calendar-dormant").nextDueInMs).toBe(24 * HOUR_MS);
  });

  it("pulls the next read inside the interval by the jitter", async () => {
    const harness = createHarness({ random: () => 0.5 });

    await runIngestRound("fleet", [claim()], harness.dependencies);

    expect(completionFor(harness, "calendar-1").nextDueInMs).toBe(10 * MINUTE_MS - 30_000);
  });

  it("retries every claim after a minute without escalating when the ingest call fails outright", async () => {
    const harness = createHarness({
      ingestCalendars: () => Promise.reject(new Error("database unavailable")),
    });

    await runIngestRound("fleet", [claim({ failureCount: 4 })], harness.dependencies);

    expect(completionFor(harness, "calendar-1")).toMatchObject({
      failed: true,
      failureCount: 4,
      nextDueInMs: MINUTE_MS,
    });
    expect(harness.errors).toEqual(["ingest-round-failed"]);
    expect(harness.enqueued).toEqual([]);
  });

  it("keeps the results of the families that ran when another family fails", async () => {
    const harness = createHarness({
      ingestCalendars: () => Promise.resolve({
        failures: [new Error("caldav listing failed")],
        result: emptyResult({
          affectedUserIds: ["user-1"],
          firstIngestUserIds: ["user-1"],
          outcomes: outcomesFor({ "calendar-ics": { kind: "ingested" } }),
        }),
      }),
    });

    await runIngestRound("fleet", [
      claim({ calendarId: "calendar-ics" }),
      claim({ calendarId: "calendar-caldav", failureCount: 2 }),
    ], harness.dependencies);

    expect(completionFor(harness, "calendar-ics")).toMatchObject({ succeeded: true });
    expect(completionFor(harness, "calendar-caldav")).toMatchObject({
      failed: true,
      failureCount: 2,
      nextDueInMs: MINUTE_MS,
      parkedReason: null,
    });
    expect(harness.errors).toEqual(["ingest-round-failed"]);
    expect(harness.events).toEqual(["complete", "first-ingest", "enqueue"]);
  });

  it("schedules on the pro interval when the calendar contexts cannot be read", async () => {
    const harness = createHarness({
      resolveScheduleContexts: () => Promise.reject(new Error("database unavailable")),
    });

    await runIngestRound("fleet", [claim()], harness.dependencies);

    expect(completionFor(harness, "calendar-1").nextDueInMs).toBe(MINUTE_MS);
    expect(harness.errors).toEqual(["ingest-schedule-context-failed"]);
  });

  it("still propagates the reads when the schedule write fails", async () => {
    const harness = createHarness({
      completeIngests: () => Promise.reject(new Error("database unavailable")),
      ingestCalendars: () => ingested(emptyResult({
        affectedUserIds: ["user-1"],
        outcomes: outcomesFor({ "calendar-1": { kind: "ingested" } }),
      })),
    });

    await runIngestRound("fleet", [claim()], harness.dependencies);

    expect(harness.errors).toEqual(["ingest-schedule-write-failed"]);
    expect(harness.enqueued.map(({ userIds }) => userIds)).toEqual([["user-1"]]);
  });

  it("does nothing for an empty claim", async () => {
    const harness = createHarness();

    await runIngestRound("fleet", [], harness.dependencies);

    expect(harness.ingestCalls).toEqual([]);
    expect(harness.completions).toEqual([]);
    expect(harness.observed).toEqual([]);
  });
});

describe("runIngestRound fleet lane", () => {
  it("reads every claim in one call and enqueues the affected users once, as a cron sync", async () => {
    const harness = createHarness({
      ingestCalendars: (calendarIds, options) => {
        harness.ingestCalls.push({ calendarIds, options });
        return ingested(emptyResult({
          affectedUserIds: ["user-a"],
          firstIngestUserIds: ["user-b"],
          outcomes: calendarIds.map((calendarId) => ({ calendarId, outcome: { kind: "ingested" } })),
        }));
      },
    });

    await runIngestRound("fleet", [
      claim({ calendarId: "calendar-a", userId: "user-a" }),
      claim({ calendarId: "calendar-b", userId: "user-b" }),
    ], harness.dependencies);

    expect(harness.ingestCalls).toHaveLength(1);
    expect(harness.ingestCalls[0]?.calendarIds).toEqual(["calendar-a", "calendar-b"]);
    expect(harness.ingestCalls[0]?.options).toMatchObject({
      claimByCalendarId: {
        "calendar-a": { lagMs: 1000, lane: "fleet", woken: false },
        "calendar-b": { lagMs: 1000, lane: "fleet", woken: false },
      },
      correlationIdByCalendarId: {},
      lane: resources,
      trigger: "cron",
    });
    expect(harness.enqueued).toEqual([{
      correlationIdByUserId: {},
      trigger: "cron",
      userIds: ["user-a", "user-b"],
      webhookReceivedAtByUserId: {},
    }]);
  });

  it("keeps a webhook's trace when the regular schedule reads the calendar first", async () => {
    const harness = createHarness({
      ingestCalendars: (calendarIds, options) => {
        harness.ingestCalls.push({ calendarIds, options });
        return ingested(emptyResult({
          affectedUserIds: ["user-1"],
          outcomes: calendarIds.map((calendarId) => ({ calendarId, outcome: { kind: "ingested" } })),
        }));
      },
    });

    await runIngestRound("fleet", [claim({
      wakeCorrelationId: "webhook-1",
      wakeReceivedAt: new Date("2026-10-26T12:00:01.000Z"),
    })], harness.dependencies);

    expect(harness.ingestCalls[0]?.options.claimByCalendarId?.["calendar-1"]).toEqual({
      lagMs: 1000,
      lane: "fleet",
      woken: true,
    });
    expect(harness.enqueued[0]).toMatchObject({
      correlationIdByUserId: { "user-1": "webhook-1" },
      webhookReceivedAtByUserId: { "user-1": Date.parse("2026-10-26T12:00:01.000Z") },
    });
  });

  it("enqueues nothing when no read changed anything", async () => {
    const harness = createHarness();

    await runIngestRound("fleet", [claim()], harness.dependencies);

    expect(harness.enqueued).toEqual([]);
  });
});

describe("runIngestRound first ingests", () => {
  it("records the sync request before it enqueues, so a free user's first push is not held back", async () => {
    const harness = createHarness({
      ingestCalendars: () => ingested(emptyResult({
        firstIngestUserIds: ["user-1"],
        outcomes: outcomesFor({ "calendar-1": { kind: "ingested" } }),
      })),
    });

    await runIngestRound("fleet", [claim()], harness.dependencies);

    expect(harness.events).toEqual(["complete", "first-ingest", "enqueue"]);
  });

  it("still enqueues when the sync request cannot be recorded", async () => {
    const harness = createHarness({
      ingestCalendars: () => ingested(emptyResult({
        firstIngestUserIds: ["user-1"],
        outcomes: outcomesFor({ "calendar-1": { kind: "ingested" } }),
      })),
      recordFirstIngestSyncRequests: () => Promise.reject(new Error("write failed")),
    });

    await runIngestRound("fleet", [claim()], harness.dependencies);

    expect(harness.errors).toEqual(["first-ingest-sync-request-failed"]);
    expect(harness.enqueued.map(({ userIds }) => userIds)).toEqual([["user-1"]]);
  });

  it("reports an enqueue failure without failing the round", async () => {
    const harness = createHarness({
      enqueueDestinationSyncs: () => Promise.reject(new Error("queue unavailable")),
      ingestCalendars: () => ingested(emptyResult({
        affectedUserIds: ["user-1"],
        outcomes: outcomesFor({ "calendar-1": { kind: "ingested" } }),
      })),
    });

    await expect(runIngestRound("fleet", [claim()], harness.dependencies)).resolves.toBeUndefined();
    expect(harness.errors).toEqual(["ingest-destination-enqueue-failed"]);
  });
});

describe("runIngestRound wake lane", () => {
  const changedResult = (calendarIds: string[], userId: string): IngestionBatchResult => emptyResult({
    affectedUserIds: [userId],
    outcomes: calendarIds.map((calendarId) => ({ calendarId, outcome: { kind: "ingested" } })),
  });

  it("reads each user's woken calendars together and enqueues that user once, as a push sync", async () => {
    const harness = createHarness({
      ingestCalendars: (calendarIds, options) => {
        harness.ingestCalls.push({ calendarIds, options });
        const owner = calendarIds[0]?.split("-")[0] ?? "";
        return ingested(changedResult(calendarIds, `user-${owner}`));
      },
    });

    await runIngestRound("wake", [
      claim({ calendarId: "alpha-1", userId: "user-alpha" }),
      claim({ calendarId: "beta-1", userId: "user-beta" }),
      claim({ calendarId: "alpha-2", userId: "user-alpha" }),
    ], harness.dependencies);

    expect(harness.ingestCalls.map(({ calendarIds }) => calendarIds).toSorted()).toEqual([
      ["alpha-1", "alpha-2"],
      ["beta-1"],
    ]);
    expect(harness.ingestCalls.every(({ options }) => options.trigger === "push")).toBe(true);
    expect(harness.enqueued.map(({ trigger, userIds }) => ({ trigger, userIds })).toSorted(
      (left, right) => String(left.userIds[0]).localeCompare(String(right.userIds[0])),
    )).toEqual([
      { trigger: "push", userIds: ["user-alpha"] },
      { trigger: "push", userIds: ["user-beta"] },
    ]);
  });

  it("carries the earliest webhook's correlation id and receipt time to the destination sync", async () => {
    const harness = createHarness({
      ingestCalendars: (calendarIds, options) => {
        harness.ingestCalls.push({ calendarIds, options });
        return ingested(changedResult(calendarIds, "user-1"));
      },
    });

    await runIngestRound("wake", [
      claim({
        calendarId: "calendar-late",
        wakeCorrelationId: "webhook-late",
        wakeReceivedAt: new Date("2026-10-26T12:00:05.000Z"),
      }),
      claim({
        calendarId: "calendar-early",
        wakeCorrelationId: "webhook-early",
        wakeReceivedAt: new Date("2026-10-26T12:00:01.000Z"),
      }),
    ], harness.dependencies);

    expect(harness.ingestCalls[0]?.options.correlationIdByCalendarId).toEqual({
      "calendar-early": "webhook-early",
      "calendar-late": "webhook-late",
    });
    expect(harness.enqueued).toEqual([{
      correlationIdByUserId: { "user-1": "webhook-early" },
      trigger: "push",
      userIds: ["user-1"],
      webhookReceivedAtByUserId: { "user-1": Date.parse("2026-10-26T12:00:01.000Z") },
    }]);
  });

  it("never reports a sign-in or mapping wake as webhook latency", async () => {
    const harness = createHarness({
      ingestCalendars: (calendarIds) => ingested(changedResult(calendarIds, "user-1")),
    });

    await runIngestRound("wake", [
      claim({ wakeCorrelationId: null, wakeReceivedAt: new Date("2026-10-26T12:00:01.000Z") }),
    ], harness.dependencies);

    expect(harness.enqueued[0]).toMatchObject({
      correlationIdByUserId: {},
      webhookReceivedAtByUserId: {},
    });
  });

  it("lets one user's failing calendar fail alone", async () => {
    const harness = createHarness({
      ingestCalendars: (calendarIds) => {
        if (calendarIds.includes("calendar-broken")) {
          return Promise.reject(new Error("provider exploded"));
        }
        return ingested(changedResult(calendarIds, "user-healthy"));
      },
    });

    await runIngestRound("wake", [
      claim({ calendarId: "calendar-broken", userId: "user-broken" }),
      claim({ calendarId: "calendar-healthy", userId: "user-healthy" }),
    ], harness.dependencies);

    expect(completionFor(harness, "calendar-broken")).toMatchObject({ failed: true });
    expect(completionFor(harness, "calendar-healthy")).toMatchObject({ succeeded: true });
    expect(harness.enqueued.map(({ userIds }) => userIds)).toEqual([["user-healthy"]]);
  });
});

describe("runIngestRound telemetry", () => {
  it("reports the lane, lag percentiles and a count per outcome", async () => {
    const harness = createHarness({
      ingestCalendars: () => ingested(emptyResult({
        outcomes: outcomesFor({
          "calendar-1": { kind: "ingested" },
          "calendar-2": { kind: "ingested" },
          "calendar-3": { kind: "lock-held" },
        }),
      })),
    });

    await runIngestRound("fleet", [
      claim({ calendarId: "calendar-1", lagMs: 100 }),
      claim({ calendarId: "calendar-2", lagMs: 300 }),
      claim({ calendarId: "calendar-3", lagMs: 9000 }),
    ], harness.dependencies);

    expect(harness.observed).toEqual([{
      "schedule.claimed_count": 3,
      "schedule.lag_ms_max": 9000,
      "schedule.lag_ms_p50": 300,
      "schedule.lag_ms_p99": 9000,
      "schedule.lane": "fleet",
      "schedule.outcome.ingested": 2,
      "schedule.outcome.lock-held": 1,
      "schedule.written_count": 3,
    }]);
  });
});
