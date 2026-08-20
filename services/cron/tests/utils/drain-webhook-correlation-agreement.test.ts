import { describe, expect, it, vi } from "vitest";
import { runDrainPendingIngest } from "../../src/utils/drain-pending-ingest";

const NOW_MS = new Date("2026-08-12T00:00:00.000Z").getTime();
const EARLIEST_WEBHOOK_MS = NOW_MS - 9000;
const LATER_WEBHOOK_MS = NOW_MS - 500;

/*
 * A signalled drain claims in signal arrival order, not score order, so the member
 * carrying the earliest score is not always the first one seen.
 */
const CLAIMED_OUT_OF_SCORE_ORDER = [
  { calendarId: "cal-late", correlationId: "correlation-late", score: LATER_WEBHOOK_MS },
  { calendarId: "cal-early", correlationId: "correlation-early", score: EARLIEST_WEBHOOK_MS },
];

const makeDependencies = () => ({
  claimPending: vi.fn(() => Promise.resolve(CLAIMED_OUT_OF_SCORE_ORDER)),
  countPending: vi.fn(() => Promise.resolve(CLAIMED_OUT_OF_SCORE_ORDER.length)),
  enabled: true,
  enqueueDestinationSyncs: vi.fn((
    _userIds: string[],
    _correlationIdByUserId: Record<string, string>,
    _webhookReceivedAtByUserId: Record<string, number>,
  ) => Promise.resolve()),
  ingestCalendars: vi.fn((_calendarIds: string[]) =>
    Promise.resolve({ affectedUserIds: ["user-1"] })),
  now: () => new Date(NOW_MS),
  observe: vi.fn(),
  recordError: vi.fn(),
  recordFailures: vi.fn((calendarIds: string[]) =>
    Promise.resolve(Object.fromEntries(calendarIds.map((calendarId) => [calendarId, 1])))),
  releaseAbandoned: vi.fn(() => Promise.resolve()),
  releasePending: vi.fn((members: { calendarId: string }[]) =>
    Promise.resolve(members.map((member) => member.calendarId))),
  resolveCalendars: vi.fn(() => Promise.resolve([
    { calendarId: "cal-late", userId: "user-1" },
    { calendarId: "cal-early", userId: "user-1" },
  ])),
  resolvePlan: vi.fn(() => Promise.resolve("pro" as const)),
});

describe("drain agreement between the correlation id and the webhook receipt time", () => {
  it("hands over the correlation id belonging to the webhook whose score travels", async () => {
    const dependencies = makeDependencies();

    await runDrainPendingIngest(dependencies);

    const [firstCall] = dependencies.enqueueDestinationSyncs.mock.calls;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[2]["user-1"]).toBe(EARLIEST_WEBHOOK_MS);
    expect(firstCall?.[1]["user-1"]).toBe("correlation-early");
  });
});
