import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushSyncDeadlinePolicy } from "@keeper.sh/constants";
import {
  createRunDeadline,
  resolveRunBudgetMs,
  resolveRunSettleTimeoutMs,
} from "../src/utils/run-deadline";

const MINUTE_MS = 60_000;

const POLICY: PushSyncDeadlinePolicy = {
  ceilingMs: 25 * MINUTE_MS,
  floorMs: 5 * MINUTE_MS,
  settleGraceMs: 5 * MINUTE_MS,
  writeBufferFactor: 1.5,
};

describe("the budget of a push sync run", () => {
  it("keeps the floor when the writes fit inside it", () => {
    expect(resolveRunBudgetMs(POLICY, 0, { operationCount: 350, requestsPerMinute: 350 })).toBe(5 * MINUTE_MS);
  });

  it("keeps the floor when the provider's pace is unknown", () => {
    expect(resolveRunBudgetMs(POLICY, 0, { operationCount: 100_000, requestsPerMinute: null })).toBe(5 * MINUTE_MS);
  });

  it("grows with the pending operations divided by the pace, times the buffer, after the time already spent", () => {
    expect(resolveRunBudgetMs(POLICY, MINUTE_MS, { operationCount: 2400, requestsPerMinute: 240 }))
      .toBe(MINUTE_MS + 10 * MINUTE_MS * 1.5);
  });

  it("stretches further when a throttled account's pace halves", () => {
    const unthrottled = resolveRunBudgetMs(POLICY, 0, { operationCount: 2400, requestsPerMinute: 240 });
    const throttled = resolveRunBudgetMs(POLICY, 0, { operationCount: 2400, requestsPerMinute: 120 });

    expect(unthrottled).toBe(15 * MINUTE_MS);
    expect(throttled).toBe(POLICY.ceilingMs);
  });

  it("stops at the ceiling so a huge backlog continues in a later run", () => {
    expect(resolveRunBudgetMs(POLICY, 0, { operationCount: 33_000, requestsPerMinute: 350 })).toBe(POLICY.ceilingMs);
  });
});

describe("the settle timeouts that guard a push sync run", () => {
  it("outlast the longest run the ceiling allows", () => {
    expect(resolveRunSettleTimeoutMs(POLICY)).toBe(30 * MINUTE_MS);
    expect(resolveRunSettleTimeoutMs(POLICY)).toBeGreaterThan(POLICY.ceilingMs);
  });

  it("scale with the ceiling", () => {
    const widerPolicy = { ...POLICY, ceilingMs: 40 * MINUTE_MS };

    expect(resolveRunSettleTimeoutMs(widerPolicy) - resolveRunSettleTimeoutMs(POLICY)).toBe(15 * MINUTE_MS);
  });
});

describe("a push sync run's deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires at the floor when no writes are planned", () => {
    const deadline = createRunDeadline(POLICY);

    vi.advanceTimersByTime(POLICY.floorMs - 1);
    expect(deadline.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(deadline.signal.aborted).toBe(true);
  });

  it("moves out once a large plan of writes is known", () => {
    const deadline = createRunDeadline(POLICY);
    vi.advanceTimersByTime(MINUTE_MS);

    deadline.planWrites({ operationCount: 2400, requestsPerMinute: 240 });

    expect(deadline.budgetMs()).toBe(16 * MINUTE_MS);
    expect(deadline.deadlineAt()).toBe(16 * MINUTE_MS);
    vi.advanceTimersByTime(15 * MINUTE_MS - 1);
    expect(deadline.signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(deadline.signal.aborted).toBe(true);
  });

  it("never shrinks once extended", () => {
    const deadline = createRunDeadline(POLICY);

    deadline.planWrites({ operationCount: 2400, requestsPerMinute: 240 });
    deadline.planWrites({ operationCount: 10, requestsPerMinute: 240 });

    expect(deadline.budgetMs()).toBe(15 * MINUTE_MS);
  });

  it("does not revive a deadline that already fired", () => {
    const deadline = createRunDeadline(POLICY);
    vi.advanceTimersByTime(POLICY.floorMs);

    deadline.planWrites({ operationCount: 2400, requestsPerMinute: 240 });

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.budgetMs()).toBe(POLICY.floorMs);
  });

  it("stops firing once cleared", () => {
    const deadline = createRunDeadline(POLICY);

    deadline.clear();
    vi.advanceTimersByTime(POLICY.ceilingMs);

    expect(deadline.signal.aborted).toBe(false);
  });
});
