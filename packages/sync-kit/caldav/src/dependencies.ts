import type { ZoneCache } from "@keeper.sh/sync-ical";
import type { InstallationId, Instant, OperationName } from "@keeper.sh/sync-protocol";
import type { DAVClient } from "tsdav";

const caldavAuthMethods = ["basic", "digest"] as const;
type CalDAVAuthMethod = (typeof caldavAuthMethods)[number];

interface CalDAVClock {
  readonly now: () => Instant;
  readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

interface CalDAVCredentials {
  readonly serverUrl: string;
  readonly username: string;
  readonly password: string;
  readonly knownAuthMethod: CalDAVAuthMethod | null;
}

interface CalDAVDependencies {
  readonly client: DAVClient;
  readonly credentials: CalDAVCredentials;
  readonly clock: CalDAVClock;
  readonly gate: <Value>(operation: OperationName, execute: () => Promise<Value>) => Promise<Value>;
  readonly hash: (input: string) => string;
  readonly installation: InstallationId;
  readonly zones: ZoneCache;
  readonly collectionConcurrency: number;
}

export { caldavAuthMethods };
export type { CalDAVAuthMethod, CalDAVClock, CalDAVCredentials, CalDAVDependencies };
