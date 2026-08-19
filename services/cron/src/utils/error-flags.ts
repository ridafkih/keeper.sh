import { isSerialFlushRunDeadlineError, isSerialFlushWorkerClosedError } from "@keeper.sh/calendar";
import { OperationTimeoutError } from "@/utils/with-abort-timeout";
import { resolveDatabaseErrorClassification } from "@keeper.sh/database";

const hasErrorFlag = (error: unknown, key: string): boolean =>
  error instanceof Error
  && key in error
  && (error as Error & Record<string, unknown>)[key] === true;

const REAUTHENTICATION_FLAGS = ["authRequired", "oauthReauthRequired"];

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
 */
const isIngestInfrastructureError = (error: unknown): boolean =>
  error instanceof OperationTimeoutError
  || isSerialFlushWorkerClosedError(error)
  || isSerialFlushRunDeadlineError(error)
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
