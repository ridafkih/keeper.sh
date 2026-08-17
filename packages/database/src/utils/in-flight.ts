/*
 * Every measure helper in the codebase records in its `finally`, so an operation that
 * is still running has contributed nothing to the wide event: when a pass wedges, the
 * one operation worth naming is the only one missing. This registry is the inverse —
 * it holds what has started and not yet returned, so a job killed mid-flight can still
 * say what it was waiting on.
 *
 * It lives here, with no dependencies of its own, because the database is the lowest
 * package that the query hook and the calendar telemetry can both reach.
 */
type InFlightKind =
  | "caldav"
  | "db_pool"
  | "db_query"
  | "lock"
  | "provider_http"
  | "rate_limit"
  | "redis"
  | "segment";

interface InFlightCall {
  kind: InFlightKind;
  startedAt: number;
  target: string;
}

interface InFlightSnapshot {
  elapsedMs: number;
  kind: InFlightKind;
  target: string;
}

const MILLISECOND_PRECISION = 100;
const CALL_ID_STEP = 1;

const inFlightCalls = new Map<number, InFlightCall>();
let nextCallId = CALL_ID_STEP;

const roundMs = (durationMs: number): number =>
  Math.round(durationMs * MILLISECOND_PRECISION) / MILLISECOND_PRECISION;

const beginInFlight = (kind: InFlightKind, target: string): number => {
  const callId = nextCallId;
  nextCallId += CALL_ID_STEP;
  inFlightCalls.set(callId, { kind, startedAt: performance.now(), target });
  return callId;
};

const endInFlight = (callId: number): void => {
  inFlightCalls.delete(callId);
};

const snapshotInFlight = (): InFlightSnapshot[] => {
  const now = performance.now();
  return [...inFlightCalls.values()]
    .map((call) => ({
      elapsedMs: roundMs(now - call.startedAt),
      kind: call.kind,
      target: call.target,
    }))
    .toSorted((left, right) => right.elapsedMs - left.elapsedMs);
};

const describeInFlight = (): string =>
  snapshotInFlight()
    .map((call) => `${call.kind}:${call.target}@${String(call.elapsedMs)}ms`)
    .join(" | ");

export { beginInFlight, describeInFlight, endInFlight, snapshotInFlight };
export type { InFlightKind, InFlightSnapshot };
