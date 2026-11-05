import type { ProviderFailure, Result, ChangeListing } from "@keeper.sh/sync-protocol";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { stallingOn } from "../src/fixtures";
import { conformanceLimits } from "../src/limits";
import { failureOf, listChanges, okValue } from "./support/drive";
import { referenceHarness, runReferenceCase } from "./support/harness";
import { foreignEvent, scopeOver, seedOf, spanning } from "./support/protocol";

const march = spanning("2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
const april = spanning("2026-04-01T00:00:00.000Z", "2026-05-01T00:00:00.000Z");
const scope = scopeOver(march);
const otherScope = scopeOver(april);

const seedEvents = [
  foreignEvent({
    uid: "alpha",
    title: "Alpha",
    start: "2026-03-02T09:00:00.000Z",
    end: "2026-03-02T10:00:00.000Z",
  }),
];

const failureKindsOf = (results: readonly PromiseSettledResult<Result<ChangeListing>>[]): string[] =>
  results.map((settled) => {
    if (settled.status === "rejected") {
      return "rejected";
    }
    if (settled.value.ok) {
      return "ok";
    }
    return settled.value.failure.kind;
  });

const notAttemptedReasonOf = (failure: ProviderFailure): string => {
  if (failure.kind === "notAttempted") {
    return failure.reason;
  }
  return `not-a-notAttempted:${failure.kind}`;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("nothing in this package can wedge", () => {
  test("CONF-L1: a retry path stops at the declared attempt ceiling", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seedEvents, []));
    harness.environment.transport.answerWith({
      kind: "reject",
      failure: {
        kind: "rateLimited",
        retryAfter: { kind: "instant", value: "2099-01-01T00:00:00.000Z" },
        scope: "perUser",
      },
      times: Number.MAX_SAFE_INTEGER,
    });

    const pending = listChanges(harness.provider, harness.environment, scope, null, {
      maxAttempts: 3,
      retryDelayCeilingMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(failureOf(await pending).kind).toBe("rateLimited");
    expect(harness.environment.transport.callCount()).toBe(3);
    await harness.dispose();
  });

  test("CONF-L1: the ceiling that stopped it is the one that was named", async () => {
    const tight = await referenceHarness();
    const loose = await referenceHarness();
    for (const harness of [tight, loose]) {
      await harness.provider.seed(seedOf(seedEvents, []));
      harness.environment.transport.answerWith({
        kind: "reject",
        failure: { kind: "rateLimited", retryAfter: null, scope: "perUser" },
        times: Number.MAX_SAFE_INTEGER,
      });
    }

    const tightRun = listChanges(tight.provider, tight.environment, scope, null, {
      maxAttempts: 2,
      retryDelayCeilingMs: 500,
    });
    const looseRun = listChanges(loose.provider, loose.environment, scope, null, {
      maxAttempts: 5,
      retryDelayCeilingMs: 500,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.allSettled([tightRun, looseRun]);

    expect(tight.environment.transport.callCount()).toBe(2);
    expect(loose.environment.transport.callCount()).toBe(5);
    await tight.dispose();
    await loose.dispose();
  });

  test("CONF-L1: a provider-supplied retry delay is capped by the budget, not obeyed", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seedEvents, []));
    harness.environment.transport.answerWith({
      kind: "reject",
      failure: {
        kind: "rateLimited",
        retryAfter: { kind: "instant", value: "2099-01-01T00:00:00.000Z" },
        scope: "perUser",
      },
      times: Number.MAX_SAFE_INTEGER,
    });
    const startedAt = Date.parse(harness.environment.clock.now().value);

    const pending = listChanges(harness.provider, harness.environment, scope, null, {
      maxAttempts: 3,
      retryDelayCeilingMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await pending;
    const elapsedOnTheFakeClock = Date.parse(harness.environment.clock.now().value) - startedAt;

    expect(elapsedOnTheFakeClock).toBeLessThanOrEqual(3 * 1000);
    await harness.dispose();
  });

  test("CONF-L2: a permanently pending transport settles as a typed failure at the deadline", async () => {
    const harness = await referenceHarness(stallingOn(() => true));
    await harness.provider.seed(seedOf(seedEvents, []));

    const pending = listChanges(harness.provider, harness.environment, scope, null, {
      deadlineMs: conformanceLimits.deadlineMs,
    });
    await vi.advanceTimersByTimeAsync(conformanceLimits.deadlineMs + 1000);

    expect(notAttemptedReasonOf(failureOf(await pending))).toBe("budgetExhausted");
    await harness.dispose();
  });

  test("CONF-L2: reaching the deadline leaves no timer behind", async () => {
    const harness = await referenceHarness(stallingOn(() => true));
    await harness.provider.seed(seedOf(seedEvents, []));

    const pending = listChanges(harness.provider, harness.environment, scope, null, {
      deadlineMs: conformanceLimits.deadlineMs,
    });
    await vi.advanceTimersByTimeAsync(conformanceLimits.deadlineMs + 1000);
    await pending;

    expect(harness.environment.clock.pendingTimers()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await harness.dispose();
  });

  test("CONF-L3: an abort mid-flight is reported as aborted, never as a provider timeout", async () => {
    const harness = await referenceHarness(stallingOn(() => true));
    await harness.provider.seed(seedOf(seedEvents, []));
    const caller = new AbortController();

    const pending = listChanges(harness.provider, harness.environment, scope, null, {
      signal: caller.signal,
      deadlineMs: conformanceLimits.deadlineMs,
    });
    await vi.advanceTimersByTimeAsync(1000);
    caller.abort();
    await vi.advanceTimersByTimeAsync(1000);

    expect(notAttemptedReasonOf(failureOf(await pending))).toBe("aborted");
    await harness.dispose();
  });

  test("CONF-L3: an abort and a deadline produce different outcomes", async () => {
    const aborted = await referenceHarness(stallingOn(() => true));
    const expired = await referenceHarness(stallingOn(() => true));
    await aborted.provider.seed(seedOf(seedEvents, []));
    await expired.provider.seed(seedOf(seedEvents, []));
    const caller = new AbortController();

    const abortedRun = listChanges(aborted.provider, aborted.environment, scope, null, {
      signal: caller.signal,
      deadlineMs: conformanceLimits.deadlineMs,
    });
    const expiredRun = listChanges(expired.provider, expired.environment, scope, null, {
      deadlineMs: conformanceLimits.deadlineMs,
    });
    await vi.advanceTimersByTimeAsync(1000);
    caller.abort();
    await vi.advanceTimersByTimeAsync(conformanceLimits.deadlineMs + 1000);

    expect(notAttemptedReasonOf(failureOf(await abortedRun))).not.toBe(
      notAttemptedReasonOf(failureOf(await expiredRun)),
    );
    await aborted.dispose();
    await expired.dispose();
  });

  test("CONF-L4: a single-flight leader's rejection reaches every follower", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seedEvents, []));
    harness.environment.transport.answerWith({ kind: "throw", times: 1 });

    const followers = Array.from({ length: 5 }, () =>
      listChanges(harness.provider, harness.environment, scope),
    );
    await vi.advanceTimersByTimeAsync(1000);
    const settled = await Promise.allSettled(followers);

    expect(settled).toHaveLength(5);
    expect(failureKindsOf(settled).filter((kind) => kind === "ok")).toEqual([]);
    await harness.dispose();
  });

  test("CONF-L4: a caller arriving after the rejection starts a fresh attempt", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seedEvents, []));
    harness.environment.transport.answerWith({ kind: "throw", times: 1 });
    const first = listChanges(harness.provider, harness.environment, scope);
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.allSettled([first]);
    const callsAfterTheFailure = harness.environment.transport.callCount();

    harness.environment.transport.answerWith({ kind: "pass" });
    const second = listChanges(harness.provider, harness.environment, scope);
    await vi.advanceTimersByTimeAsync(1000);

    expect(okValue(await second).kind).toBe("snapshot");
    expect(harness.environment.transport.callCount()).toBeGreaterThan(callsAfterTheFailure);
    await harness.dispose();
  });

  test("CONF-L5: coalesced callers each receive their own diagnostics object", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seedEvents, []));

    const leading = listChanges(harness.provider, harness.environment, scope);
    const following = listChanges(harness.provider, harness.environment, scope);
    await vi.advanceTimersByTimeAsync(1000);
    const first = okValue(await leading);
    const second = okValue(await following);

    expect(first.diagnostics).not.toBe(second.diagnostics);
    expect(first.diagnostics).toEqual(second.diagnostics);
    await harness.dispose();
  });

  test("CONF-L6: overlapping key sets acquired in opposite orders both settle", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seedEvents, []));

    const forward = Promise.all([
      listChanges(harness.provider, harness.environment, scope),
      listChanges(harness.provider, harness.environment, otherScope),
    ]);
    const backward = Promise.all([
      listChanges(harness.provider, harness.environment, otherScope),
      listChanges(harness.provider, harness.environment, scope),
    ]);
    await vi.advanceTimersByTimeAsync(conformanceLimits.deadlineMs);
    const settled = await Promise.allSettled([forward, backward]);

    expect(settled.map((entry) => entry.status)).toEqual(["fulfilled", "fulfilled"]);
    await harness.dispose();
  });

  test("CONF-L7: a lease taken by a synchronously throwing body is released", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seedEvents, []));
    harness.environment.transport.answerWith({ kind: "throw", times: 1 });
    const thrown = listChanges(harness.provider, harness.environment, scope);
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.allSettled([thrown]);

    harness.environment.transport.answerWith({ kind: "pass" });
    const afterwards = listChanges(harness.provider, harness.environment, scope, null, {
      deadlineMs: conformanceLimits.deadlineMs,
    });
    await vi.advanceTimersByTimeAsync(conformanceLimits.deadlineMs);

    expect(okValue(await afterwards).kind).toBe("snapshot");
    await harness.dispose();
  });

  test("CONF-L7: a lease taken by a rejecting body is released", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seedEvents, []));
    harness.environment.transport.answerWith({
      kind: "reject",
      failure: { kind: "transport", status: 500, disposition: "permanent" },
      times: 1,
    });
    const rejected = listChanges(harness.provider, harness.environment, scope);
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.allSettled([rejected]);

    harness.environment.transport.answerWith({ kind: "pass" });
    const afterwards = listChanges(harness.provider, harness.environment, scope, null, {
      deadlineMs: conformanceLimits.deadlineMs,
    });
    await vi.advanceTimersByTimeAsync(conformanceLimits.deadlineMs);

    expect(okValue(await afterwards).kind).toBe("snapshot");
    await harness.dispose();
  });

  test("CONF-L8: no timer survives a completed operation", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seedEvents, []));

    const listing = listChanges(harness.provider, harness.environment, scope);
    await vi.advanceTimersByTimeAsync(1000);
    await listing;
    await vi.advanceTimersByTimeAsync(conformanceLimits.deadlineMs * 4);

    expect(harness.environment.clock.pendingTimers()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await harness.dispose();
  });

  test("CONF-L8: no timer survives a failed operation", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seedEvents, []));
    harness.environment.transport.answerWith({ kind: "throw", times: 1 });

    const listing = listChanges(harness.provider, harness.environment, scope);
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.allSettled([listing]);
    await vi.advanceTimersByTimeAsync(conformanceLimits.deadlineMs * 4);

    expect(harness.environment.clock.pendingTimers()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await harness.dispose();
  });

  test("CONF-L9: an aborted waiter does not strand the waiters behind it", async () => {
    const harness = await referenceHarness(stallingOn(() => true));
    await harness.provider.seed(seedOf(seedEvents, []));
    const cancelled = new AbortController();

    const first = listChanges(harness.provider, harness.environment, scope, null, {
      deadlineMs: conformanceLimits.deadlineMs,
    });
    const second = listChanges(harness.provider, harness.environment, scope, null, {
      signal: cancelled.signal,
      deadlineMs: conformanceLimits.deadlineMs,
    });
    const third = listChanges(harness.provider, harness.environment, scope, null, {
      deadlineMs: conformanceLimits.deadlineMs,
    });
    await vi.advanceTimersByTimeAsync(1000);
    cancelled.abort();
    await vi.advanceTimersByTimeAsync(conformanceLimits.deadlineMs + 1000);
    const settled = await Promise.allSettled([first, second, third]);

    expect(settled.map((entry) => entry.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    expect(notAttemptedReasonOf(failureOf(await first))).not.toBe("aborted");
    expect(notAttemptedReasonOf(failureOf(await third))).not.toBe("aborted");
    await harness.dispose();
  });

  test("CONF-L10: an aborted queued task does not leak its concurrency permit", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seedEvents, []));
    const cancelled = new AbortController();

    const indices = [...Array.from({ length: conformanceLimits.fanOutTasks }).keys()];
    const queued = indices.map((index) => {
      if (index === 1) {
        return listChanges(harness.provider, harness.environment, scope, null, {
          signal: cancelled.signal,
        });
      }
      return listChanges(harness.provider, harness.environment, scope);
    });
    cancelled.abort();
    await vi.advanceTimersByTimeAsync(conformanceLimits.deadlineMs);
    const settled = await Promise.allSettled(queued);

    expect(settled).toHaveLength(conformanceLimits.fanOutTasks);
    expect(settled.filter((entry) => entry.status === "rejected")).toEqual([]);
    await harness.dispose();
  });

  test("CONF-L11: a fan-out returns one result per task even when one stalls forever", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seedEvents, []));

    const tasks = Array.from({ length: conformanceLimits.fanOutTasks }, () =>
      listChanges(harness.provider, harness.environment, scope, null, {
        deadlineMs: conformanceLimits.deadlineMs,
      }),
    );
    harness.environment.transport.stall();
    await vi.advanceTimersByTimeAsync(conformanceLimits.deadlineMs + 1000);
    const settled = await Promise.allSettled(tasks);

    expect(settled).toHaveLength(conformanceLimits.fanOutTasks);
    expect(settled.filter((entry) => entry.status === "rejected")).toEqual([]);
    await harness.dispose();
  });

  test("CONF-L11: a fan-out never exceeds the declared concurrency", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seedEvents, []));

    const tasks = Array.from({ length: conformanceLimits.fanOutTasks }, () =>
      listChanges(harness.provider, harness.environment, scope),
    );
    await vi.advanceTimersByTimeAsync(conformanceLimits.deadlineMs);
    await Promise.allSettled(tasks);

    expect(harness.environment.transport.inFlightPeak()).toBeLessThanOrEqual(
      conformanceLimits.concurrency,
    );
    await harness.dispose();
  });

  test("CONF-L12: an unattempted run is neither a success nor a failure", async () => {
    const harness = await referenceHarness();
    await harness.provider.seed(seedOf(seedEvents, []));
    const caller = new AbortController();
    caller.abort();

    const result = await listChanges(harness.provider, harness.environment, scope, null, {
      signal: caller.signal,
    });

    expect(notAttemptedReasonOf(failureOf(result))).toBe("aborted");
    expect(harness.environment.transport.callCount()).toBe(0);
    await harness.dispose();
  });

});

describe("the generated lockup cases drive real timers, as an adapter's own suite will", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  test.each(["CONF-L1", "CONF-L2", "CONF-L3", "CONF-L4", "CONF-L7", "CONF-L11", "CONF-L12"] as const)(
    "%s: the generated case passes for the reference provider",
    async (id) => {
      await expect(runReferenceCase(id)).resolves.toBeUndefined();
    },
  );
});
