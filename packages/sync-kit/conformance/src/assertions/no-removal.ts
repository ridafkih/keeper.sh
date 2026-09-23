import type {
  CalendarKey,
  ChangeListing,
  EventTime,
  RemoteEventId,
  TimeWindow,
  WindowMembership,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { violated } from "../violation";

interface KnownIdentity {
  readonly uid: string;
  readonly id: RemoteEventId;
  readonly time: EventTime;
}

interface KnownMirror {
  readonly calendar: CalendarKey;
  readonly entries: readonly KnownIdentity[];
}

interface RemovalBasis {
  readonly listing: ChangeListing;
  readonly known: KnownMirror;
  readonly withinWindow: WindowMembership;
}

const assertNoRemovalDerivable = (listing: ChangeListing): void => {
  switch (listing.kind) {
    case "partial":
    case "cursorLost": {
      return;
    }
    case "snapshot":
    case "delta": {
      throw violated(
        "CONF-O1",
        `a "${listing.kind}" listing carries deletion authority, so a removal is derivable from it`,
      );
    }
    default: {
      return assertNever(listing);
    }
  }
};

const provesTheWholeRequest = (covered: TimeWindow, requested: TimeWindow): boolean =>
  covered.start.value === requested.start.value && covered.end.value === requested.end.value;

const presentIdentities = (
  listing: Extract<ChangeListing, { kind: "snapshot" }>,
): ReadonlySet<string> =>
  new Set([
    ...listing.events.map((event) => event.uid.value),
    ...listing.withheld.flatMap((entry) => {
      if (entry.uid === null) {
        return [];
      }
      return [entry.uid.value];
    }),
  ]);

const namedRemovals = (listing: Extract<ChangeListing, { kind: "delta" }>): readonly string[] =>
  listing.removals.flatMap((removal) => {
    if (removal.kind === "outOfScope") {
      return [];
    }
    return [removal.uid.value];
  });

const absentFromSnapshot = (
  listing: Extract<ChangeListing, { kind: "snapshot" }>,
  basis: RemovalBasis,
): readonly string[] => {
  if (listing.coverage.calendar.calendar.value !== basis.known.calendar.calendar.value) {
    return [];
  }
  if (!provesTheWholeRequest(listing.coverage.covered, listing.scope.window)) {
    return [];
  }
  const present = presentIdentities(listing);
  const covered = basis.known.entries.filter((entry) =>
    basis.withinWindow(listing.coverage.covered, entry.time),
  );
  return covered.filter((entry) => !present.has(entry.uid)).map((entry) => entry.uid);
};

const derivableRemovals = (basis: RemovalBasis): readonly string[] => {
  const { listing } = basis;
  switch (listing.kind) {
    case "partial":
    case "cursorLost": {
      return [];
    }
    case "delta": {
      const named = new Set(namedRemovals(listing));
      return basis.known.entries
        .filter((entry) => named.has(entry.uid))
        .map((entry) => entry.uid);
    }
    case "snapshot": {
      return absentFromSnapshot(listing, basis);
    }
    default: {
      return assertNever(listing);
    }
  }
};

export { assertNoRemovalDerivable, derivableRemovals };
export type { KnownIdentity, KnownMirror, RemovalBasis };
