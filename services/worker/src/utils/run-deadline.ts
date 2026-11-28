import { MS_PER_MINUTE } from "@keeper.sh/constants";
import type { PushSyncDeadlinePolicy } from "@keeper.sh/constants";

interface PlannedWrites {
  operationCount: number;
  requestsPerMinute: number | null;
}

interface RunDeadline {
  signal: AbortSignal;
  budgetMs: () => number;
  deadlineAt: () => number;
  planWrites: (plannedWrites: PlannedWrites) => void;
  clear: () => void;
}

const estimateWriteDurationMs = ({ operationCount, requestsPerMinute }: PlannedWrites): number => {
  if (requestsPerMinute === null || requestsPerMinute <= 0 || operationCount <= 0) {
    return 0;
  }
  return (operationCount / requestsPerMinute) * MS_PER_MINUTE;
};

const resolveRunBudgetMs = (
  policy: PushSyncDeadlinePolicy,
  elapsedMs: number,
  plannedWrites: PlannedWrites,
): number => {
  const neededMs = Math.ceil(elapsedMs + estimateWriteDurationMs(plannedWrites) * policy.writeBufferFactor);
  return Math.min(policy.ceilingMs, Math.max(policy.floorMs, neededMs));
};

const resolveRunSettleTimeoutMs = (policy: PushSyncDeadlinePolicy): number =>
  policy.ceilingMs + policy.settleGraceMs;

const createRunDeadline = (
  policy: PushSyncDeadlinePolicy,
  now: () => number = Date.now,
): RunDeadline => {
  const startedAt = now();
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  let budgetMs = policy.floorMs;
  let timer = setTimeout(abort, budgetMs);

  const planWrites = (plannedWrites: PlannedWrites): void => {
    if (controller.signal.aborted) {
      return;
    }
    const plannedBudgetMs = resolveRunBudgetMs(policy, now() - startedAt, plannedWrites);
    if (plannedBudgetMs <= budgetMs) {
      return;
    }
    budgetMs = plannedBudgetMs;
    clearTimeout(timer);
    timer = setTimeout(abort, startedAt + budgetMs - now());
  };

  return {
    budgetMs: () => budgetMs,
    clear: () => {
      clearTimeout(timer);
    },
    deadlineAt: () => startedAt + budgetMs,
    planWrites,
    signal: controller.signal,
  };
};

export { createRunDeadline, resolveRunBudgetMs, resolveRunSettleTimeoutMs };
