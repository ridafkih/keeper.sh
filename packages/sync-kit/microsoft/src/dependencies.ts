import type { InstallationId, Instant, OperationName } from "@keeper.sh/sync-protocol";
import type { Client } from "@microsoft/microsoft-graph-client";

interface MicrosoftClock {
  readonly now: () => Instant;
  readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

interface MicrosoftDependencies {
  readonly graph: Client;
  readonly clock: MicrosoftClock;
  readonly gate: <Value>(operation: OperationName, execute: () => Promise<Value>) => Promise<Value>;
  readonly hash: (input: string) => string;
  readonly installation: InstallationId;
  readonly mailboxConcurrency: number;
  readonly randomFraction: () => number;
}

export type { MicrosoftClock, MicrosoftDependencies };
