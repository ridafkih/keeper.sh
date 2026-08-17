import { widelog } from "widelogger";
import {
  beginInFlight,
  describeInFlight,
  endInFlight,
  snapshotInFlight,
} from "@keeper.sh/database";
import type { InFlightKind, InFlightSnapshot } from "@keeper.sh/database";

const EMPTY = 0;

/*
 * The oldest open operation is promoted to its own fields because it is the one that
 * answers "why": everything else in the stack is waiting behind it.
 */
const recordInFlightOnWideEvent = (prefix: string): void => {
  const calls = snapshotInFlight();
  widelog.set(`${prefix}.open_count`, calls.length);
  if (calls.length === EMPTY) {
    return;
  }
  const [oldest] = calls;
  if (!oldest) {
    return;
  }
  widelog.set(`${prefix}.blocking_kind`, oldest.kind);
  widelog.set(`${prefix}.blocking_target`, oldest.target);
  widelog.set(`${prefix}.blocking_elapsed_ms`, oldest.elapsedMs);
  widelog.set(`${prefix}.open_stack`, describeInFlight());
};

const measureInFlight = async <TResult>(
  kind: InFlightKind,
  target: string,
  operation: () => Promise<TResult>,
): Promise<TResult> => {
  const callId = beginInFlight(kind, target);
  try {
    return await operation();
  } finally {
    endInFlight(callId);
  }
};

export {
  beginInFlight,
  describeInFlight,
  endInFlight,
  measureInFlight,
  recordInFlightOnWideEvent,
  snapshotInFlight,
};
export type { InFlightKind, InFlightSnapshot };
