import {
  isIngestPacingParkAbortError,
  isSerialFlushReserveAbortError,
  isSerialFlushRunDeadlineError,
  isSerialFlushWorkerClosedError,
} from "@keeper.sh/calendar";
import { resolveDatabaseErrorClassification } from "@keeper.sh/database";

const hasErrorFlag = (error: unknown, key: string): boolean =>
  error instanceof Error
  && key in error
  && (error as Error & Record<string, unknown>)[key] === true;

const REAUTHENTICATION_FLAGS = ["authRequired", "oauthReauthRequired"];

/*
 * The exact rejection ioredis raises on every command once disconnect() has
 * torn the client down. Shutdown (index.ts) disconnects refreshLockRedis
 * while the in-flight ingest pass is still running, so a mid-flight task's
 * next lock/limiter/lease round trip fails with this error — keeper closed
 * its own client; the provider was never contacted. ioredis exposes no error
 * class for this rejection, only a bare Error with this message.
 */
const REDIS_CONNECTION_CLOSED_MESSAGE = "Connection is closed.";

const isRedisTeardownError = (error: unknown): boolean =>
  error instanceof Error && error.message === REDIS_CONNECTION_CLOSED_MESSAGE;

/*
 * Errors produced by ingest infrastructure — a reserve parked on the shared
 * flush budget until the source deadline fired, the flush writer rejecting
 * parked reservers at shutdown, or the pump's client-side run deadline firing
 * on a wedged flush — never contacted the calendar's provider, so they must
 * not be treated as provider failures. A Postgres statement timeout (57014)
 * belongs here too: the bounded advisory-lock wait inside the flush
 * transaction fires it when keeper's own write-back (sync-user, API caldav
 * persist) holds the same (namespace, calendarId) lock past the 5s bound,
 * and every statement_timeout keeper sets bounds its own database — a
 * provider is never on the other side of that cancellation.
 *
 * A source-deadline OperationTimeoutError is NOT infrastructure by itself:
 * withAbortTimeout raises the same class when a hung or persistently slow
 * provider overruns the 120s deadline, and that timeout must accrue ingest
 * backoff. Only a timeout observed while still parked on keeper's own
 * pacing, ahead of the provider request it gates — the flush worker's
 * reserve (reserve-before-fetch), the shared per-host or per-user rate
 * limiter, or an account concurrency semaphore — carries a park flag and
 * stays exempt.
 */
const isIngestInfrastructureError = (error: unknown): boolean =>
  isSerialFlushReserveAbortError(error)
  || isIngestPacingParkAbortError(error)
  || isSerialFlushWorkerClosedError(error)
  || isSerialFlushRunDeadlineError(error)
  || isRedisTeardownError(error)
  || resolveDatabaseErrorClassification(error)?.slug === "db-statement-timeout";

/*
 * Every call site uses this predicate as an exemption gate for
 * provider-failure handling (ingest backoff, missing-calendar
 * classification). Infrastructure errors carry the same exemption as
 * reauthentication errors: neither is evidence the provider misbehaved.
 */
const requiresReauthentication = (error: unknown): boolean =>
  REAUTHENTICATION_FLAGS.some((flag) => hasErrorFlag(error, flag))
  || isIngestInfrastructureError(error);

export { hasErrorFlag, isIngestInfrastructureError, requiresReauthentication };
