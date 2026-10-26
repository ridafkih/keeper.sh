import { DEFAULT_INGEST_INTERVAL_DIALS } from "@keeper.sh/calendar";
import type { IngestIntervalDials } from "@keeper.sh/calendar";
import { INGEST_SOURCE_TIMEOUT_MS } from "@keeper.sh/constants";

const SECOND_MS = 1000;
const DAY_MS = 24 * 60 * 60 * SECOND_MS;

interface IngestLaneDials {
  batchSize: number;
  capacity: number;
  idleMs: number;
}

interface IngestDials {
  dormantAfterMs: number | null;
  fleet: IngestLaneDials;
  intervals: IngestIntervalDials;
  leaseMs: number;
  loopEnabled: boolean;
  outlookRequestsPerMinute: number | null;
  wake: IngestLaneDials;
}

interface IngestDialEnvironment {
  INGEST_CLAIM_BATCH?: number;
  INGEST_DORMANT_AFTER_DAYS?: number;
  INGEST_DORMANT_POLL_SECONDS?: number;
  INGEST_FLEET_CONCURRENCY?: number;
  INGEST_FLEET_IDLE_MS?: number;
  INGEST_FREE_POLL_SECONDS?: number;
  INGEST_FREE_SAFETY_POLL_SECONDS?: number;
  INGEST_LEASE_SECONDS?: number;
  INGEST_LOOP_ENABLED?: boolean;
  INGEST_PRO_POLL_SECONDS?: number;
  INGEST_PRO_SAFETY_POLL_SECONDS?: number;
  INGEST_WAKE_CONCURRENCY?: number;
  INGEST_WAKE_IDLE_MS?: number;
  OUTLOOK_INGEST_REQUESTS_PER_MINUTE?: number;
}

const DEFAULT_FLEET_CONCURRENCY = 64;
const DEFAULT_WAKE_CONCURRENCY = 16;
const DEFAULT_CLAIM_BATCH = 50;
const DEFAULT_FLEET_IDLE_MS = 2000;
const DEFAULT_WAKE_IDLE_MS = 1000;
const DEFAULT_DORMANT_AFTER_DAYS = 30;
const DEFAULT_LEASE_MS = 2 * INGEST_SOURCE_TIMEOUT_MS;

const isPositive = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

const positive = (value: number | undefined, fallback: number): number => {
  if (!isPositive(value)) {
    return fallback;
  }
  return value;
};

const secondsOr = (value: number | undefined, fallbackMs: number): number => {
  if (!isPositive(value)) {
    return fallbackMs;
  }
  return value * SECOND_MS;
};

const resolveDormantAfterMs = (days: number | undefined): number | null => {
  if (days === 0) {
    return null;
  }
  return positive(days, DEFAULT_DORMANT_AFTER_DAYS) * DAY_MS;
};

const resolveProviderLimit = (value: number | undefined): number | null => {
  if (!isPositive(value)) {
    return null;
  }
  return value;
};

const resolveIngestDials = (environment: IngestDialEnvironment): IngestDials => {
  const batchSize = Math.floor(positive(environment.INGEST_CLAIM_BATCH, DEFAULT_CLAIM_BATCH));
  return {
    dormantAfterMs: resolveDormantAfterMs(environment.INGEST_DORMANT_AFTER_DAYS),
    fleet: {
      batchSize,
      capacity: Math.floor(positive(environment.INGEST_FLEET_CONCURRENCY, DEFAULT_FLEET_CONCURRENCY)),
      idleMs: positive(environment.INGEST_FLEET_IDLE_MS, DEFAULT_FLEET_IDLE_MS),
    },
    intervals: {
      dormantMs: secondsOr(environment.INGEST_DORMANT_POLL_SECONDS, DEFAULT_INGEST_INTERVAL_DIALS.dormantMs),
      freePollMs: secondsOr(environment.INGEST_FREE_POLL_SECONDS, DEFAULT_INGEST_INTERVAL_DIALS.freePollMs),
      freeSafetyMs: secondsOr(
        environment.INGEST_FREE_SAFETY_POLL_SECONDS,
        DEFAULT_INGEST_INTERVAL_DIALS.freeSafetyMs,
      ),
      proPollMs: secondsOr(environment.INGEST_PRO_POLL_SECONDS, DEFAULT_INGEST_INTERVAL_DIALS.proPollMs),
      proSafetyMs: secondsOr(
        environment.INGEST_PRO_SAFETY_POLL_SECONDS,
        DEFAULT_INGEST_INTERVAL_DIALS.proSafetyMs,
      ),
    },
    leaseMs: secondsOr(environment.INGEST_LEASE_SECONDS, DEFAULT_LEASE_MS),
    loopEnabled: environment.INGEST_LOOP_ENABLED !== false,
    outlookRequestsPerMinute: resolveProviderLimit(environment.OUTLOOK_INGEST_REQUESTS_PER_MINUTE),
    wake: {
      batchSize,
      capacity: Math.floor(positive(environment.INGEST_WAKE_CONCURRENCY, DEFAULT_WAKE_CONCURRENCY)),
      idleMs: positive(environment.INGEST_WAKE_IDLE_MS, DEFAULT_WAKE_IDLE_MS),
    },
  };
};

export { resolveIngestDials };
export type { IngestDialEnvironment, IngestDials, IngestLaneDials };
