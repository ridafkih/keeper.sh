import { resolveCalendarBackoffDelayMs } from "../utils/calendar-backoff";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MAX_JITTER_MS = 2 * MINUTE_MS;
const JITTER_SHARE = 0.1;

type IngestPlan = "free" | "pro";

interface IngestIntervalDials {
  dormantMs: number;
  freePollMs: number;
  freeSafetyMs: number;
  proPollMs: number;
  proSafetyMs: number;
}

const DEFAULT_INGEST_INTERVAL_DIALS: IngestIntervalDials = {
  dormantMs: 24 * HOUR_MS,
  freePollMs: 10 * MINUTE_MS,
  freeSafetyMs: HOUR_MS,
  proPollMs: MINUTE_MS,
  proSafetyMs: 5 * MINUTE_MS,
};

interface IngestIntervalInput {
  dormant: boolean;
  plan: IngestPlan;
  pushHealthy: boolean;
}

const resolveBaseIntervalMs = (
  input: IngestIntervalInput,
  dials: IngestIntervalDials,
): number => {
  if (input.pushHealthy) {
    if (input.plan === "pro") {
      return dials.proSafetyMs;
    }
    return dials.freeSafetyMs;
  }
  if (input.plan === "pro") {
    return dials.proPollMs;
  }
  return dials.freePollMs;
};

const resolveIngestIntervalMs = (
  input: IngestIntervalInput,
  dials: IngestIntervalDials = DEFAULT_INGEST_INTERVAL_DIALS,
): number => {
  const intervalMs = resolveBaseIntervalMs(input, dials);
  if (input.dormant) {
    return Math.max(intervalMs, dials.dormantMs);
  }
  return intervalMs;
};

const resolveIngestJitterMs = (intervalMs: number, random: () => number = Math.random): number =>
  Math.floor(random() * Math.min(intervalMs * JITTER_SHARE, MAX_JITTER_MS));

const WAKE_DEBOUNCE_MS: Record<IngestPlan, number> = {
  free: 5 * MINUTE_MS,
  pro: 0,
};

const resolveWakeDebounceMs = (plan: IngestPlan): number => WAKE_DEBOUNCE_MS[plan];

type IngestOutcome =
  | { kind: "ingested" }
  | { kind: "lock-held" }
  | { kind: "baseline-moved" }
  | { kind: "unresolvable" }
  | { kind: "failed"; backoff: boolean }
  | { kind: "request-rejected" }
  | { kind: "credential-rejected" };

type IngestParkedReason = "credential-rejected" | "unresolvable";

interface IngestScheduleDecision {
  attempted: boolean;
  failed: boolean;
  failureCount: number;
  nextDueInMs: number;
  parkedReason: IngestParkedReason | null;
  succeeded: boolean;
}

interface IngestScheduleDecisionInput {
  failureCount: number;
  intervalMs: number;
  jitterMs: number;
}

const LOCK_HELD_RETRY_MS = 30_000;
const BASELINE_MOVED_RETRY_MS = 5000;
const UNBACKED_FAILURE_RETRY_MS = MINUTE_MS;
const UNRESOLVABLE_PROBE_MS = HOUR_MS;
const CREDENTIAL_PROBE_MS = 24 * HOUR_MS;

const scheduleNextRead = (input: IngestScheduleDecisionInput): IngestScheduleDecision => ({
  attempted: true,
  failed: false,
  failureCount: 0,
  nextDueInMs: Math.max(0, input.intervalMs - input.jitterMs),
  parkedReason: null,
  succeeded: true,
});

const retryUnattempted = (
  input: IngestScheduleDecisionInput,
  retryMs: number,
): IngestScheduleDecision => ({
  attempted: false,
  failed: false,
  failureCount: input.failureCount,
  nextDueInMs: retryMs,
  parkedReason: null,
  succeeded: false,
});

const parkUnresolvable = (input: IngestScheduleDecisionInput): IngestScheduleDecision => ({
  attempted: true,
  failed: false,
  failureCount: input.failureCount,
  nextDueInMs: UNRESOLVABLE_PROBE_MS,
  parkedReason: "unresolvable",
  succeeded: false,
});

const parkRejectedCredential = (input: IngestScheduleDecisionInput): IngestScheduleDecision => ({
  attempted: true,
  failed: true,
  failureCount: input.failureCount + 1,
  nextDueInMs: CREDENTIAL_PROBE_MS,
  parkedReason: "credential-rejected",
  succeeded: false,
});

const retryUnbackedFailure = (input: IngestScheduleDecisionInput): IngestScheduleDecision => ({
  attempted: true,
  failed: true,
  failureCount: input.failureCount,
  nextDueInMs: UNBACKED_FAILURE_RETRY_MS,
  parkedReason: null,
  succeeded: false,
});

const backOff = (input: IngestScheduleDecisionInput): IngestScheduleDecision => ({
  attempted: true,
  failed: true,
  failureCount: input.failureCount + 1,
  nextDueInMs: resolveCalendarBackoffDelayMs(input.failureCount),
  parkedReason: null,
  succeeded: false,
});

const resolveIngestScheduleDecision = (
  outcome: IngestOutcome,
  input: IngestScheduleDecisionInput,
): IngestScheduleDecision => {
  if (outcome.kind === "ingested") {
    return scheduleNextRead(input);
  }
  if (outcome.kind === "lock-held") {
    return retryUnattempted(input, LOCK_HELD_RETRY_MS);
  }
  if (outcome.kind === "baseline-moved") {
    return retryUnattempted(input, BASELINE_MOVED_RETRY_MS);
  }
  if (outcome.kind === "unresolvable") {
    return parkUnresolvable(input);
  }
  if (outcome.kind === "credential-rejected") {
    return parkRejectedCredential(input);
  }
  if (outcome.kind === "failed" && !outcome.backoff) {
    return retryUnbackedFailure(input);
  }
  return backOff(input);
};

export {
  BASELINE_MOVED_RETRY_MS,
  CREDENTIAL_PROBE_MS,
  DEFAULT_INGEST_INTERVAL_DIALS,
  LOCK_HELD_RETRY_MS,
  UNBACKED_FAILURE_RETRY_MS,
  UNRESOLVABLE_PROBE_MS,
  resolveIngestIntervalMs,
  resolveIngestJitterMs,
  resolveIngestScheduleDecision,
  resolveWakeDebounceMs,
};
export type {
  IngestIntervalDials,
  IngestIntervalInput,
  IngestOutcome,
  IngestParkedReason,
  IngestPlan,
  IngestScheduleDecision,
  IngestScheduleDecisionInput,
};
