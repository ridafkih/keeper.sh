import {
  isIngestPacingParkAbortError,
  isSerialFlushReserveAbortError,
  isSerialFlushRunDeadlineError,
  isSerialFlushWorkerClosedError,
} from "@keeper.sh/calendar";
import { hasBoundedDatabaseCloseBegun, resolveDatabaseErrorClassification } from "@keeper.sh/database";

const hasErrorFlag = (error: unknown, key: string): boolean =>
  error instanceof Error
  && key in error
  && (error as Error & Record<string, unknown>)[key] === true;

const REAUTHENTICATION_FLAGS = ["authRequired", "oauthReauthRequired"];

const REDIS_CONNECTION_CLOSED_MESSAGE = "Connection is closed.";

const isRedisTeardownError = (error: unknown): boolean =>
  error instanceof Error && error.message === REDIS_CONNECTION_CLOSED_MESSAGE;

const SHUTDOWN_CLOSE_CONNECTION_SLUGS = new Set([
  "db-connection-terminated",
  "db-connection-unavailable",
]);

/*
 * Connection-class errors count as infrastructure only once shutdown's bounded close has
 * begun and keeper is killing its own pool. During normal operation the same slugs are
 * genuine evidence of a failing provider, so this must never become a blanket slug exemption.
 */
const isShutdownForceCloseError = (error: unknown): boolean => {
  if (!hasBoundedDatabaseCloseBegun()) {
    return false;
  }
  const classification = resolveDatabaseErrorClassification(error);
  if (classification === null) {
    return false;
  }
  return SHUTDOWN_CLOSE_CONNECTION_SLUGS.has(classification.slug);
};

const isIngestInfrastructureError = (error: unknown): boolean =>
  isSerialFlushReserveAbortError(error)
  || isShutdownForceCloseError(error)
  || isIngestPacingParkAbortError(error)
  || isSerialFlushWorkerClosedError(error)
  || isSerialFlushRunDeadlineError(error)
  || isRedisTeardownError(error)
  || resolveDatabaseErrorClassification(error)?.slug === "db-statement-timeout";

const requiresReauthentication = (error: unknown): boolean =>
  REAUTHENTICATION_FLAGS.some((flag) => hasErrorFlag(error, flag))
  || isIngestInfrastructureError(error);

export { hasErrorFlag, isIngestInfrastructureError, requiresReauthentication };
