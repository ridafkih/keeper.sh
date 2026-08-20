import { describe, expect, it, vi } from "vitest";
import { runDrainPendingIngest } from "../../src/utils/drain-pending-ingest";

const NOW_MS = new Date("2026-08-12T00:00:00.000Z").getTime();
const EARLIEST_WEBHOOK_MS = NOW_MS - 9000;
const LATER_WEBHOOK_MS = NOW_MS - 500;

const makeDependencies = (overrides: Record<string, unknown> = {}) => ({
  claimPending: vi.fn(() => Promise.resolve([{
    calendarId: "cal-1",
    correlationId: "correlation-a",
    score: EARLIEST_WEBHOOK_MS,
  }])),
  countPending: vi.fn(() => Promise.resolve(1)),
  enabled: true,
  enqueueDestinationSyncs: vi.fn(() => Promise.resolve()),
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
  resolveCalendars: vi.fn(() => Promise.resolve([{ calendarId: "cal-1", userId: "user-1" }])),
  resolvePlan: vi.fn(() => Promise.resolve("pro" as const)),
  ...overrides,
});

const webhookMapFromFirstEnqueue = (
  enqueueDestinationSyncs: { mock: { calls: unknown[][] } },
): unknown => enqueueDestinationSyncs.mock.calls[0]?.[2];

describe("drain propagation of the webhook receipt time", () => {
  it("passes the queued score to the destination syncs it enqueues", async () => {
    const dependencies = makeDependencies();

    await runDrainPendingIngest(dependencies);

    expect(webhookMapFromFirstEnqueue(dependencies.enqueueDestinationSyncs)).toEqual({
      "user-1": EARLIEST_WEBHOOK_MS,
    });
  });

  it("reports the earliest webhook when one user has several pending calendars", async () => {
    const dependencies = makeDependencies({
      claimPending: vi.fn(() => Promise.resolve([
        { calendarId: "cal-1", correlationId: "correlation-a", score: EARLIEST_WEBHOOK_MS },
        { calendarId: "cal-2", correlationId: "correlation-b", score: LATER_WEBHOOK_MS },
      ])),
      resolveCalendars: vi.fn(() => Promise.resolve([
        { calendarId: "cal-1", userId: "user-1" },
        { calendarId: "cal-2", userId: "user-1" },
      ])),
    });

    await runDrainPendingIngest(dependencies);

    const { calls }: { calls: unknown[][] } = dependencies.enqueueDestinationSyncs.mock;
    for (const call of calls) {
      expect(call[2]).toEqual({ "user-1": EARLIEST_WEBHOOK_MS });
    }
  });
});
