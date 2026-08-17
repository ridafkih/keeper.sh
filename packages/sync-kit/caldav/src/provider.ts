import type {
  AccountId,
  CalendarEnumeration,
  CalendarProvider,
  ChangeListing,
  EditableContent,
  ListChangesRequest,
  NormalizedContent,
  OperationContext,
  Result,
  WriteIntent,
  WriteOutcome,
} from "@keeper.sh/sync-protocol";
import { discoverCalendars } from "./calendars/discover";
import { caldavCapabilities } from "./capabilities";
import { PermitAborted } from "./client/semaphore";
import { FlightAbandoned } from "./client/single-flight";
import type { CalDAVDependencies } from "./dependencies";
import type { CalDAVInternals } from "./internals";
import { createCalDAVInternals } from "./internals";
import { listCalDAVChanges } from "./listing/list-changes";
import { normalizeCalDAVContent } from "./write/normalize";
import { writeCalDAV } from "./write/write";

const abandoned = <Value>(): Result<Value> => ({
  ok: false,
  failure: { kind: "notAttempted", reason: "aborted" },
});

const isAbandonment = (error: unknown): boolean =>
  error instanceof PermitAborted || error instanceof FlightAbandoned;

const collapsed = <Value>(error: unknown, signal: AbortSignal): Result<Value> => {
  if (signal.aborted || isAbandonment(error)) {
    return abandoned<Value>();
  }
  return { ok: false, failure: { kind: "transport", status: null, disposition: "permanent" } };
};

const settled = <Value>(
  running: Promise<Result<Value>>,
  signal: AbortSignal,
): Promise<Result<Value>> => running.catch((error: unknown) => collapsed<Value>(error, signal));

const providerOver = (internals: CalDAVInternals): CalendarProvider<"caldav"> => ({
  capabilities: caldavCapabilities,
  listCalendars: (account: AccountId, context: OperationContext): Promise<Result<CalendarEnumeration>> =>
    settled(discoverCalendars(internals, account, context), context.signal),
  listChanges: (
    request: ListChangesRequest,
    context: OperationContext,
  ): Promise<Result<ChangeListing>> =>
    settled(listCalDAVChanges(internals, request, context), context.signal),
  normalize: (content: EditableContent): Result<NormalizedContent<"caldav">> =>
    normalizeCalDAVContent(internals.dependencies, content),
  write: (
    intent: WriteIntent<"caldav">,
    context: OperationContext,
  ): Promise<Result<WriteOutcome>> =>
    settled(writeCalDAV(internals, intent, context), context.signal),
});

const createCalDAVProvider = (dependencies: CalDAVDependencies): CalendarProvider<"caldav"> =>
  providerOver(createCalDAVInternals(dependencies));

export { createCalDAVProvider, providerOver };
