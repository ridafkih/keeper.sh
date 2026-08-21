import { describe, expect, it, vi } from "vitest";
import type { PendingIngestMember } from "../../src/utils/drain-pending-ingest";
import { runDrainPendingIngest } from "../../src/utils/drain-pending-ingest";

const NOW_MS = new Date("2026-08-12T00:00:00.000Z").getTime();
const EARLIEST_WEBHOOK_MS = NOW_MS - 9000;
const LATER_WEBHOOK_MS = NOW_MS - 500;

const CLAIMED_MEMBERS: PendingIngestMember[] = [
  { calendarId: "cal-late", correlationId: "correlation-late", score: LATER_WEBHOOK_MS },
  { calendarId: "cal-early", score: EARLIEST_WEBHOOK_MS },
];

const makeDependencies = () => ({
  claimPending: vi.fn(() => Promise.resolve(CLAIMED_MEMBERS)),
  countPending: vi.fn(() => Promise.resolve(CLAIMED_MEMBERS.length)),
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
  releaseClaims: vi.fn(() => Promise.resolve()),
  releasePending: vi.fn((members: PendingIngestMember[]) =>
    Promise.resolve(members.map((member) => member.calendarId))),
  resolveCalendars: vi.fn(() => Promise.resolve([
    { calendarId: "cal-late", userId: "user-1" },
    { calendarId: "cal-early", userId: "user-1" },
  ])),
  resolvePlan: vi.fn(() => Promise.resolve("pro" as const)),
});

describe("drain attribution when the earliest woken calendar carries no correlation id", () => {
  it("names one pending member with both the correlation id and the receipt stamp", async () => {
    const dependencies = makeDependencies();

    await runDrainPendingIngest(dependencies);

    const [firstCall] = dependencies.enqueueDestinationSyncs.mock.calls;
    expect(firstCall).toBeDefined();

    const stamp = firstCall?.[2]["user-1"];
    const described = CLAIMED_MEMBERS.find((member) => member.score === stamp);
    expect(described).toBeDefined();

    const carried = firstCall?.[1]["user-1"] ?? "";
    expect(carried).toBe(described?.correlationId ?? "");
  });
});
