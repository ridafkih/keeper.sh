import { describe, expect, it, vi } from "vitest";
import {
  MAX_DRAIN_BATCH,
  MAX_PENDING_FAILURES,
  runDrainPendingIngest,
} from "../../src/utils/drain-pending-ingest";

const NOW_MS = new Date("2026-08-12T00:00:00.000Z").getTime();

const makeDependencies = (overrides: Record<string, unknown> = {}) => ({
  claimPending: vi.fn(() => Promise.resolve([{ calendarId: "cal-1", score: NOW_MS }])),
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
  releasePending: vi.fn((members: { calendarId: string; score: number }[]) =>
    Promise.resolve(members.map((member) => member.calendarId))),
  resolveCalendars: vi.fn(() => Promise.resolve([{ calendarId: "cal-1", userId: "user-1" }])),
  resolvePlan: vi.fn(() => Promise.resolve("pro" as const)),
  ...overrides,
});

const resolveOwnerUserId = (calendarId: string): string => {
  if (calendarId === "cal-young") {
    return "good-user";
  }
  return `broken-${calendarId}`;
};

const observedFields = (
  observe: ReturnType<typeof vi.fn>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = {};
  for (const call of observe.mock.calls) {
    Object.assign(merged, call[0]);
  }
  return merged;
};

describe("runDrainPendingIngest when push is unconfigured", () => {
  it("returns zero and never touches Redis", async () => {
    const dependencies = makeDependencies({ enabled: false });

    await expect(runDrainPendingIngest(dependencies)).resolves.toBe(0);

    expect(dependencies.claimPending).not.toHaveBeenCalled();
    expect(dependencies.countPending).not.toHaveBeenCalled();
    expect(dependencies.resolveCalendars).not.toHaveBeenCalled();
    expect(dependencies.ingestCalendars).not.toHaveBeenCalled();
    expect(dependencies.releasePending).not.toHaveBeenCalled();
    expect(dependencies.enqueueDestinationSyncs).not.toHaveBeenCalled();
  });
});

describe("runDrainPendingIngest queue depth", () => {
  it("reports the pending depth measured before the claim", async () => {
    const dependencies = makeDependencies({
      countPending: vi.fn(() => Promise.resolve(120)),
    });

    await runDrainPendingIngest(dependencies);

    expect(observedFields(dependencies.observe)["push_drain.pending_count"]).toBe(120);
  });

  it("reports the pending depth even when nothing is claimable", async () => {
    const dependencies = makeDependencies({
      claimPending: vi.fn(() => Promise.resolve([])),
      countPending: vi.fn(() => Promise.resolve(0)),
    });

    await runDrainPendingIngest(dependencies);

    expect(observedFields(dependencies.observe)["push_drain.pending_count"]).toBe(0);
  });
});

describe("runDrainPendingIngest happy path", () => {
  it("claims, resolves, ingests, releases and enqueues in that order", async () => {
    const callLog: string[] = [];
    const dependencies = makeDependencies({
      claimPending: vi.fn(() => {
        callLog.push("claimPending");
        return Promise.resolve([{ calendarId: "cal-1", score: NOW_MS }]);
      }),
      enqueueDestinationSyncs: vi.fn(() => {
        callLog.push("enqueueDestinationSyncs");
        return Promise.resolve();
      }),
      ingestCalendars: vi.fn(() => {
        callLog.push("ingestCalendars");
        return Promise.resolve({ affectedUserIds: ["user-1"] });
      }),
      releasePending: vi.fn((members: { calendarId: string }[]) => {
        callLog.push("releasePending");
        return Promise.resolve(members.map((member) => member.calendarId));
      }),
      resolveCalendars: vi.fn(() => {
        callLog.push("resolveCalendars");
        return Promise.resolve([{ calendarId: "cal-1", userId: "user-1" }]);
      }),
    });

    await runDrainPendingIngest(dependencies);

    expect(callLog).toEqual([
      "claimPending",
      "resolveCalendars",
      "ingestCalendars",
      "releasePending",
      "enqueueDestinationSyncs",
    ]);
    expect(dependencies.ingestCalendars).toHaveBeenCalledWith(["cal-1"]);
    expect(dependencies.enqueueDestinationSyncs).toHaveBeenCalledWith(["user-1"]);
  });

  it("claims the oldest members up to the batch cap", async () => {
    const pending = Array.from({ length: 120 }, (_unused, index) => ({
      calendarId: `cal-${index}`,
      score: NOW_MS + index,
    }));
    const dependencies = makeDependencies({
      claimPending: vi.fn((limit: number) => Promise.resolve(pending.slice(0, limit))),
      resolveCalendars: vi.fn((calendarIds: string[]) => Promise.resolve(
        calendarIds.map((calendarId) => ({ calendarId, userId: "user-1" })),
      )),
    });

    await runDrainPendingIngest(dependencies);

    expect(dependencies.claimPending).toHaveBeenCalledWith(MAX_DRAIN_BATCH);
    expect(dependencies.ingestCalendars.mock.calls[0]?.[0]).toHaveLength(MAX_DRAIN_BATCH);
  });

  it("does nothing when there is nothing pending", async () => {
    const dependencies = makeDependencies({
      claimPending: vi.fn(() => Promise.resolve([])),
    });

    await expect(runDrainPendingIngest(dependencies)).resolves.toBe(0);
    expect(dependencies.ingestCalendars).not.toHaveBeenCalled();
    expect(dependencies.enqueueDestinationSyncs).not.toHaveBeenCalled();
  });
});

describe("runDrainPendingIngest release semantics", () => {
  it("releases a claimed member only while its score is unchanged", async () => {
    const scores = new Map<string, number>([
      ["cal-1", NOW_MS],
      ["cal-2", NOW_MS],
    ]);
    const dependencies = makeDependencies({
      claimPending: vi.fn(() => Promise.resolve(
        [...scores].map(([calendarId, score]) => ({ calendarId, score })),
      )),
      ingestCalendars: vi.fn(() => {
        scores.set("cal-1", NOW_MS + 5000);
        return Promise.resolve({ affectedUserIds: ["user-1"] });
      }),
      releasePending: vi.fn((members: { calendarId: string; score: number }[]) => {
        const removed: string[] = [];
        for (const member of members) {
          const current = scores.get(member.calendarId) ?? null;
          if (current !== null && current <= member.score) {
            scores.delete(member.calendarId);
            removed.push(member.calendarId);
          }
        }
        return Promise.resolve(removed);
      }),
      resolveCalendars: vi.fn((calendarIds: string[]) => Promise.resolve(
        calendarIds.map((calendarId) => ({ calendarId, userId: "user-1" })),
      )),
    });

    await runDrainPendingIngest(dependencies);

    expect([...scores.keys()]).toEqual(["cal-1"]);
    expect(observedFields(dependencies.observe)["push_drain.retained_count"]).toBe(1);
  });

  it("releases a claimed member whose calendar no longer resolves", async () => {
    const dependencies = makeDependencies({
      claimPending: vi.fn(() => Promise.resolve([
        { calendarId: "cal-1", score: NOW_MS },
        { calendarId: "cal-gone", score: NOW_MS },
      ])),
    });

    await runDrainPendingIngest(dependencies);

    expect(dependencies.ingestCalendars).toHaveBeenCalledWith(["cal-1"]);
    const released = dependencies.releasePending.mock.calls
      .flatMap(([members]) => (members as { calendarId: string }[]).map((member) => member.calendarId));
    expect(released).toContain("cal-gone");
    expect(observedFields(dependencies.observe)["push_drain.unresolved_count"]).toBe(1);
  });
});

describe("runDrainPendingIngest plan gating", () => {
  it("keeps free-plan calendars off the accelerated path", async () => {
    const dependencies = makeDependencies({
      claimPending: vi.fn(() => Promise.resolve([
        { calendarId: "cal-pro", score: NOW_MS },
        { calendarId: "cal-free", score: NOW_MS },
      ])),
      resolveCalendars: vi.fn(() => Promise.resolve([
        { calendarId: "cal-pro", userId: "pro-user" },
        { calendarId: "cal-free", userId: "free-user" },
      ])),
      resolvePlan: vi.fn((userId: string) => {
        if (userId === "pro-user") {
          return Promise.resolve("pro" as const);
        }
        return Promise.resolve("free" as const);
      }),
    });

    await runDrainPendingIngest(dependencies);

    expect(dependencies.ingestCalendars).toHaveBeenCalledWith(["cal-pro"]);
    expect(observedFields(dependencies.observe)["push_drain.skipped_plan_count"]).toBe(1);
  });

  it("confines an unresolvable plan to the affected user", async () => {
    const dependencies = makeDependencies({
      claimPending: vi.fn(() => Promise.resolve([
        { calendarId: "cal-good", score: NOW_MS },
        { calendarId: "cal-broken", score: NOW_MS },
      ])),
      resolveCalendars: vi.fn(() => Promise.resolve([
        { calendarId: "cal-good", userId: "good-user" },
        { calendarId: "cal-broken", userId: "broken-user" },
      ])),
      resolvePlan: vi.fn((userId: string) => {
        if (userId === "broken-user") {
          return Promise.reject(new Error("Unable to resolve user plan for broken-user"));
        }
        return Promise.resolve("pro" as const);
      }),
    });

    await expect(runDrainPendingIngest(dependencies)).resolves.toBeGreaterThan(0);

    expect(dependencies.ingestCalendars).toHaveBeenCalledWith(["cal-good"]);
    expect(observedFields(dependencies.observe)["push_drain.plan_error_count"]).toBe(1);
  });

  it("counts a plan-error member as a per-member failure so it cannot stall the queue", async () => {
    const dependencies = makeDependencies({
      claimPending: vi.fn(() => Promise.resolve([
        { calendarId: "cal-good", score: NOW_MS },
        { calendarId: "cal-broken", score: NOW_MS },
      ])),
      resolveCalendars: vi.fn(() => Promise.resolve([
        { calendarId: "cal-good", userId: "good-user" },
        { calendarId: "cal-broken", userId: "broken-user" },
      ])),
      resolvePlan: vi.fn((userId: string) => {
        if (userId === "broken-user") {
          return Promise.reject(new Error("Unable to resolve user plan for broken-user"));
        }
        return Promise.resolve("pro" as const);
      }),
    });

    await runDrainPendingIngest(dependencies);

    expect(dependencies.recordFailures).toHaveBeenCalledWith(["cal-broken"]);
    expect(dependencies.releaseAbandoned).not.toHaveBeenCalled();
    expect(dependencies.ingestCalendars).toHaveBeenCalledWith(["cal-good"]);
  });

  it("abandons a persistently unresolvable member once it reaches the failure bound", async () => {
    const dependencies = makeDependencies({
      claimPending: vi.fn(() => Promise.resolve([
        { calendarId: "cal-broken", score: NOW_MS },
      ])),
      recordFailures: vi.fn((calendarIds: string[]) =>
        Promise.resolve(Object.fromEntries(
          calendarIds.map((calendarId) => [calendarId, MAX_PENDING_FAILURES]),
        ))),
      resolveCalendars: vi.fn(() => Promise.resolve([
        { calendarId: "cal-broken", userId: "broken-user" },
      ])),
      resolvePlan: vi.fn(() => Promise.reject(new Error("Unable to resolve user plan"))),
    });

    await runDrainPendingIngest(dependencies);

    expect(dependencies.recordFailures).toHaveBeenCalledWith(["cal-broken"]);
    expect(dependencies.releaseAbandoned).toHaveBeenCalledWith(["cal-broken"]);
    expect(observedFields(dependencies.observe)["push_drain.abandoned"]).toBe(1);
  });

  it("never lets plan-error members starve younger members across repeated ticks", async () => {
    const blockedIds = Array.from(
      { length: MAX_DRAIN_BATCH },
      (_unused, index) => `cal-blocked-${index}`,
    );
    const pending = new Map<string, number>([
      ...blockedIds.map((calendarId, index): [string, number] => [calendarId, NOW_MS + index]),
      ["cal-young", NOW_MS + MAX_DRAIN_BATCH],
    ]);

    const failureCounts = new Map<string, number>();
    const dependencies = makeDependencies({
      claimPending: vi.fn((limit: number) =>
        Promise.resolve(
          [...pending.entries()]
            .toSorted(([, left], [, right]) => left - right)
            .slice(0, limit)
            .map(([calendarId, score]) => ({ calendarId, score })),
        )),
      countPending: vi.fn(() => Promise.resolve(pending.size)),
      recordFailures: vi.fn((calendarIds: string[]) => {
        for (const calendarId of calendarIds) {
          failureCounts.set(calendarId, (failureCounts.get(calendarId) ?? 0) + 1);
        }
        return Promise.resolve(Object.fromEntries(
          calendarIds.map((calendarId) => [calendarId, failureCounts.get(calendarId) ?? 0]),
        ));
      }),
      releaseAbandoned: vi.fn((calendarIds: string[]) => {
        for (const calendarId of calendarIds) {
          pending.delete(calendarId);
        }
        return Promise.resolve();
      }),
      releasePending: vi.fn((members: { calendarId: string; score: number }[]) => {
        for (const member of members) {
          pending.delete(member.calendarId);
        }
        return Promise.resolve(members.map((member) => member.calendarId));
      }),
      resolveCalendars: vi.fn((calendarIds: string[]) =>
        Promise.resolve(calendarIds.map((calendarId) => ({
          calendarId,
          userId: resolveOwnerUserId(calendarId),
        })))),
      resolvePlan: vi.fn((userId: string) => {
        if (userId === "good-user") {
          return Promise.resolve("pro" as const);
        }
        return Promise.reject(new Error(`Unable to resolve user plan for ${userId}`));
      }),
    });

    for (let tick = 0; tick < MAX_PENDING_FAILURES + 2; tick += 1) {
      await runDrainPendingIngest(dependencies);
    }

    expect(dependencies.ingestCalendars).toHaveBeenCalledWith(["cal-young"]);
    expect(pending.has("cal-young")).toBe(false);
  });
});

describe("runDrainPendingIngest failure handling", () => {
  it("retains everything and reports rather than throwing when the batch fails", async () => {
    const dependencies = makeDependencies({
      ingestCalendars: vi.fn(() => Promise.reject(new Error("database down"))),
    });

    await expect(runDrainPendingIngest(dependencies)).resolves.toBe(0);

    expect(dependencies.releasePending).not.toHaveBeenCalled();
    expect(dependencies.recordFailures).toHaveBeenCalledWith(["cal-1"]);
    const [, slug] = dependencies.recordError.mock.calls[0] as [unknown, string];
    expect(slug).toBe("push-drain-batch-failed");
  });

  it("abandons a member that survived too many consecutive batch failures", async () => {
    const dependencies = makeDependencies({
      ingestCalendars: vi.fn(() => Promise.reject(new Error("database down"))),
      recordFailures: vi.fn((calendarIds: string[]) => Promise.resolve(
        Object.fromEntries(calendarIds.map((calendarId) => [calendarId, MAX_PENDING_FAILURES])),
      )),
    });

    await runDrainPendingIngest(dependencies);

    expect(dependencies.releaseAbandoned).toHaveBeenCalledWith(["cal-1"]);
    expect(observedFields(dependencies.observe)["push_drain.abandoned"]).toBe(1);
  });

  it("reports queue depth and age so latency stays measurable", async () => {
    const dependencies = makeDependencies({
      claimPending: vi.fn(() => Promise.resolve([
        { calendarId: "cal-1", score: NOW_MS - 4000 },
        { calendarId: "cal-2", score: NOW_MS - 1000 },
      ])),
      resolveCalendars: vi.fn((calendarIds: string[]) => Promise.resolve(
        calendarIds.map((calendarId) => ({ calendarId, userId: "user-1" })),
      )),
    });

    await runDrainPendingIngest(dependencies);

    const fields = observedFields(dependencies.observe);
    expect(fields["push_drain.batch_count"]).toBe(2);
    expect(fields["push_drain.queue_age_ms_max"]).toBe(5000);
  });
});
