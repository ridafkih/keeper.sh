import type { calendar_v3 } from "@googleapis/calendar";
import type { InstallationId, Instant, OperationName } from "@keeper.sh/sync-protocol";

interface GoogleClock {
  readonly now: () => Instant;
  readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

interface GoogleDependencies {
  readonly calendar: calendar_v3.Calendar;
  readonly clock: GoogleClock;
  readonly gate: <Value>(operation: OperationName, execute: () => Promise<Value>) => Promise<Value>;
  readonly hash: (input: string) => string;
  readonly installation: InstallationId;
  readonly concurrency: number;
  readonly randomId: () => string;
  readonly randomFraction: () => number;
}

export type { GoogleClock, GoogleDependencies };
