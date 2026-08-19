import { isSerialFlushWorkerClosedError } from "@keeper.sh/calendar";
import { OperationTimeoutError } from "@/utils/with-abort-timeout";

const hasErrorFlag = (error: unknown, key: string): boolean =>
  error instanceof Error
  && key in error
  && (error as Error & Record<string, unknown>)[key] === true;

const REAUTHENTICATION_FLAGS = ["authRequired", "oauthReauthRequired"];

/*
 * Errors produced by ingest infrastructure — a reserve parked on the shared
 * flush budget until the source deadline fired, or the flush writer rejecting
 * parked reservers at shutdown — never contacted the calendar's provider, so
 * they must not be treated as provider failures.
 */
const isIngestInfrastructureError = (error: unknown): boolean =>
  error instanceof OperationTimeoutError || isSerialFlushWorkerClosedError(error);

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
