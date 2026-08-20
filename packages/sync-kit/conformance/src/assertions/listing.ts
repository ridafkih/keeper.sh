import type {
  ChangeListing,
  ListingDiagnostics,
  ListingScope,
  RemoteEvent,
  Removal,
  Result,
  WithheldEvent,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { CanonicalValue } from "../canonical";
import { canonicalise } from "../canonical";
import { violated } from "../violation";

const assertNotSnapshotUnderTruncation = (result: Result<ChangeListing>): void => {
  if (!result.ok) {
    return;
  }
  if (result.value.kind === "snapshot" || result.value.kind === "delta") {
    throw violated(
      "CONF-O1",
      `a truncated read answered "${result.value.kind}", which claims coverage it never proved`,
    );
  }
};

const assertCoverageProven = (listing: ChangeListing, scope: ListingScope): void => {
  if (listing.kind === "partial" || listing.kind === "cursorLost") {
    return;
  }
  if (listing.coverage.calendar.calendar.value !== scope.calendar.calendar.value) {
    throw violated(
      "CONF-O4",
      "the listing proved coverage for a calendar other than the one it was asked about",
    );
  }
};

const assertCursorWithheld = (result: Result<ChangeListing>): void => {
  if (!result.ok) {
    return;
  }
  if (result.value.cursor) {
    throw violated("CONF-O24", "a run that did not complete still returned a sync cursor");
  }
};

const identifiersOf = (event: RemoteEvent): CanonicalValue => ({
  id: event.id.value,
  uid: event.uid.value,
  deleteHandle: event.deleteHandle.value,
  version: event.version.value,
  fingerprint: event.fingerprint.value,
});

const loggableDiagnostics = (diagnostics: ListingDiagnostics): CanonicalValue => ({
  withheld: [...diagnostics.withheld.sample],
  selfAuthored: [...diagnostics.selfAuthored.sample],
  unrepresentable: [...diagnostics.unrepresentable.sample],
  pagesFetched: diagnostics.pagesFetched,
});

const loggableEvents = (events: readonly RemoteEvent[]): CanonicalValue =>
  events.map((event) => identifiersOf(event));

const loggableWithheld = (withheld: readonly WithheldEvent[]): CanonicalValue =>
  withheld.map((entry) => ({
    uid: entry.uid?.value ?? null,
    id: entry.id?.value ?? null,
    reason: entry.reason,
  }));

const loggableRemovals = (removals: readonly Removal[]): CanonicalValue =>
  removals.map((removal) => ({ kind: removal.kind, id: removal.id.value }));

const loggableFacts = (listing: ChangeListing): CanonicalValue => {
  switch (listing.kind) {
    case "snapshot":
    case "delta": {
      return {
        kind: listing.kind,
        diagnostics: loggableDiagnostics(listing.diagnostics),
        events: loggableEvents(listing.events),
        withheld: loggableWithheld(listing.withheld),
        removals: loggableRemovals(listing.removals),
        cursor: listing.cursor?.value ?? null,
      };
    }
    case "partial": {
      return {
        kind: listing.kind,
        diagnostics: loggableDiagnostics(listing.diagnostics),
        events: loggableEvents(listing.events),
        withheld: loggableWithheld(listing.withheld),
        continuation: listing.continuation.value,
      };
    }
    case "cursorLost": {
      return { kind: listing.kind, diagnostics: loggableDiagnostics(listing.diagnostics) };
    }
    default: {
      return assertNever(listing);
    }
  }
};

const assertNoContentInDiagnostics = (
  listing: ChangeListing,
  secrets: readonly string[],
): void => {
  const loggable = canonicalise(loggableFacts(listing));
  const leaked = secrets.filter((secret) => loggable.includes(secret));
  if (leaked.length > 0) {
    throw violated(
      "CONF-O19",
      `${leaked.length} content value(s) reached the loggable half of the listing`,
    );
  }
};

export {
  assertCoverageProven,
  assertCursorWithheld,
  assertNoContentInDiagnostics,
  assertNotSnapshotUnderTruncation,
};
