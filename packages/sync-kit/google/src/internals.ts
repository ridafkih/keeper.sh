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
import { createRequestSeam } from "./client/request";
import type { RequestSeam } from "./client/request";
import { createSemaphore } from "./client/semaphore";
import type { Semaphore } from "./client/semaphore";
import { createSingleFlight } from "./client/single-flight";
import type { SingleFlight } from "./client/single-flight";
import { googleCapabilities } from "./capabilities";
import type { GoogleDependencies } from "./dependencies";
import { listGoogleCalendars } from "./calendars/list-calendars";
import type { CursorFrontier } from "./listing/list-changes";
import { listGoogleChanges } from "./listing/list-changes";
import { googleListingLimits } from "./limits";
import { createMintedEventIds } from "./write/minted-ids";
import type { MintedEventIds } from "./write/minted-ids";
import { normalizeForGoogle } from "./write/normalize";
import { writeToGoogle } from "./write/write";

interface GoogleInternals {
  readonly provider: CalendarProvider<"google">;
  readonly requests: RequestSeam;
  readonly permits: Semaphore;
  readonly flights: SingleFlight<Result<ChangeListing>>;
  readonly mintedIds: MintedEventIds;
  readonly inFlightKeys: () => readonly string[];
  readonly deletionCalendars: () => readonly string[];
}

const createCursorFrontier = (): CursorFrontier => {
  const held = new Map<string, string>();
  return {
    latest: (fingerprint: string) => held.get(fingerprint) ?? null,
    advance: (fingerprint: string, value: string) => {
      held.set(fingerprint, value);
    },
  };
};

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

const createGoogleInternals = (dependencies: GoogleDependencies): GoogleInternals => {
  const permits = createSemaphore(dependencies.concurrency);
  const requests = createRequestSeam({ dependencies, permits });
  const flights = createSingleFlight<Result<ChangeListing>>();
  const frontier = createCursorFrontier();
  const mintedIds = createMintedEventIds(googleListingLimits.mintedIdMemory);
  const seen: { observed: readonly string[] } = { observed: [] };

  const listChanges = async (
    request: ListChangesRequest,
    context: OperationContext,
  ): Promise<Result<ChangeListing>> => {
    const answered = await listGoogleChanges(request, context, {
      dependencies,
      requests,
      flights,
      frontier,
      mintedIds,
    });
    seen.observed = calendarsBehind(answered);
    return answered;
  };

  return {
    provider: {
      capabilities: googleCapabilities,
      listCalendars: (account: AccountId, context: OperationContext) =>
        listGoogleCalendars(account, context, { dependencies, requests }),
      listChanges,
      normalize: (content: EditableContent) => normalizeForGoogle(content, dependencies.hash),
      write: (intent: WriteIntent<"google">, context: OperationContext) =>
        writeToGoogle(intent, context, { dependencies, requests, mintedIds }),
    },
    requests,
    permits,
    flights,
    mintedIds,
    inFlightKeys: () => flights.inFlightKeys(),
    deletionCalendars: () => seen.observed,
  };
};

export { createCursorFrontier, createGoogleInternals };
export type { GoogleInternals };
