import { describe, expect, it, vi } from "vitest";
import { runDrainPendingIngest } from "../../src/utils/drain-pending-ingest";

const NOW_MS = new Date("2026-08-12T00:00:00.000Z").getTime();
const WEBHOOK_CORRELATION_ID = "correlation-from-webhook";

const makeDependencies = (overrides: Record<string, unknown> = {}) => ({
  claimPending: vi.fn(() => Promise.resolve([{
    calendarId: "cal-1",
    correlationId: WEBHOOK_CORRELATION_ID,
    score: NOW_MS,
  }])),
  countPending: vi.fn(() => Promise.resolve(1)),
  enabled: true,
  enqueueDestinationSyncs: vi.fn(() => Promise.resolve()),
  ingestCalendars: vi.fn((_calendarIds: string[]) =>
    Promise.resolve({ affectedUserIds: ["user-1"] })),
  now: () => new Date(NOW_MS + 1000),
  observe: vi.fn(),
  recordError: vi.fn(),
  recordFailures: vi.fn((calendarIds: string[]) =>
    Promise.resolve(Object.fromEntries(calendarIds.map((calendarId) => [calendarId, 1])))),
  releaseAbandoned: vi.fn(() => Promise.resolve()),
  releaseClaims: vi.fn(() => Promise.resolve()),
  releasePending: vi.fn((members: { calendarId: string }[]) =>
    Promise.resolve(members.map((member) => member.calendarId))),
  resolveCalendars: vi.fn(() => Promise.resolve([{ calendarId: "cal-1", userId: "user-1" }])),
  resolvePlan: vi.fn(() => Promise.resolve("pro" as const)),
  ...overrides,
});

describe("drain propagation of the webhook correlation id", () => {
  it("passes the queued id to the ingest it triggers", async () => {
    const dependencies = makeDependencies();

    await runDrainPendingIngest(dependencies);

    expect(dependencies.ingestCalendars).toHaveBeenCalledWith(
      ["cal-1"],
      { "cal-1": WEBHOOK_CORRELATION_ID },
    );
  });

  it("passes the queued id to the destination syncs it enqueues", async () => {
    const dependencies = makeDependencies();

    await runDrainPendingIngest(dependencies);

    expect(dependencies.enqueueDestinationSyncs).toHaveBeenCalledWith(
      ["user-1"],
      { "user-1": WEBHOOK_CORRELATION_ID },
      { "user-1": NOW_MS },
    );
  });

  it("keeps two calendars drained together on their own ids", async () => {
    const dependencies = makeDependencies({
      claimPending: vi.fn(() => Promise.resolve([
        { calendarId: "cal-1", correlationId: "correlation-a", score: NOW_MS },
        { calendarId: "cal-2", correlationId: "correlation-b", score: NOW_MS },
      ])),
      resolveCalendars: vi.fn(() => Promise.resolve([
        { calendarId: "cal-1", userId: "user-1" },
        { calendarId: "cal-2", userId: "user-2" },
      ])),
    });

    await runDrainPendingIngest(dependencies);

    expect(dependencies.ingestCalendars.mock.calls).toEqual([
      [["cal-1"], { "cal-1": "correlation-a" }],
      [["cal-2"], { "cal-2": "correlation-b" }],
    ]);
  });
});
