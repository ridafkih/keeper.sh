import type {
  AccountId,
  CalendarProvider,
  ChangeListing,
  EditableContent,
  ListChangesRequest,
  OperationContext,
  RemoteEvent,
  Result,
  WriteIntent,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { listMicrosoftCalendars } from "./calendars/list-calendars";
import { microsoftCapabilities } from "./capabilities";
import { raceDeadline } from "./client/deadline";
import { createRequestSeam } from "./client/request";
import type { RequestSeam } from "./client/request";
import { createMailboxSemaphore } from "./client/semaphore";
import type { MailboxSemaphore } from "./client/semaphore";
import { createSingleFlight } from "./client/single-flight";
import type { SingleFlight } from "./client/single-flight";
import { createCursorFrontier } from "./cursor/frontier";
import { createGraphZones } from "./decode/zone";
import type { MicrosoftDependencies } from "./dependencies";
import { listMicrosoftChanges } from "./listing/list-changes";
import { normalizeForMicrosoft } from "./write/normalize";
import { writeToGraph } from "./write/write";

interface MicrosoftInternals {
  readonly provider: CalendarProvider<"microsoft">;
  readonly requests: RequestSeam;
  readonly permits: MailboxSemaphore;
  readonly flights: SingleFlight<Result<ChangeListing>>;
  readonly inFlightKeys: () => readonly string[];
  readonly deletionCalendars: () => readonly string[];
}

const eventCalendars = (events: readonly RemoteEvent[]): readonly string[] =>
  events.map((event) => event.calendar.calendar.value);

const provenCalendars = (listing: ChangeListing): readonly string[] => {
  switch (listing.kind) {
    case "delta":
    case "snapshot": {
      return [...eventCalendars(listing.events), listing.coverage.calendar.calendar.value];
    }
    case "partial":
    case "cursorLost": {
      return [];
    }
    default: {
      return assertNever(listing);
    }
  }
};

const calendarsBehind = (answered: Result<ChangeListing>): readonly string[] => {
  if (!answered.ok) {
    return [];
  }
  return [...new Set(provenCalendars(answered.value))];
};

const withinDeadline = async <Value>(
  context: OperationContext,
  dependencies: MicrosoftDependencies,
  execute: (bounded: OperationContext) => Promise<Result<Value>>,
): Promise<Result<Value>> => {
  const raced = await raceDeadline(context, dependencies.clock, (signal) =>
    execute({ ...context, signal }),
  );
  if (raced.kind === "notAttempted") {
    return { ok: false, failure: { kind: "notAttempted", reason: raced.reason } };
  }
  return raced.value;
};

const createMicrosoftInternals = (dependencies: MicrosoftDependencies): MicrosoftInternals => {
  const permits = createMailboxSemaphore(dependencies.mailboxConcurrency);
  const requests = createRequestSeam({ dependencies, permits });
  const flights = createSingleFlight<Result<ChangeListing>>();
  const frontier = createCursorFrontier();
  const zones = createGraphZones();
  const seen: { observed: readonly string[] } = { observed: [] };

  const listChanges = async (
    request: ListChangesRequest,
    context: OperationContext,
  ): Promise<Result<ChangeListing>> => {
    const answered = await listMicrosoftChanges(request, context, {
      dependencies,
      requests,
      flights,
      frontier,
      zones,
    });
    seen.observed = calendarsBehind(answered);
    return answered;
  };

  return {
    provider: {
      capabilities: microsoftCapabilities,
      listCalendars: (account: AccountId, context: OperationContext) =>
        withinDeadline(context, dependencies, (bounded) =>
          listMicrosoftCalendars(account, bounded, { dependencies, requests }),
        ),
      listChanges,
      normalize: (content: EditableContent) =>
        normalizeForMicrosoft(content, dependencies.hash),
      write: (intent: WriteIntent<"microsoft">, context: OperationContext) =>
        withinDeadline(context, dependencies, (bounded) =>
          writeToGraph(intent, bounded, { dependencies, requests, zones }),
        ),
    },
    requests,
    permits,
    flights,
    inFlightKeys: () => flights.inFlightKeys(),
    deletionCalendars: () => seen.observed,
  };
};

export { createMicrosoftInternals };
export type { MicrosoftInternals };
