import type { CalendarEnumeration, CalendarKey } from "./calendar-ref";
import type { AuthoritativeRemoval, ChangeListing } from "./change-listing";
import type { RemoteEventId } from "./handles";
import type { WindowMembership } from "./time";

type SnapshotListing = Extract<ChangeListing, { kind: "snapshot" }>;
type DeltaListing = Extract<ChangeListing, { kind: "delta" }>;

interface KnownEvents {
  readonly calendar: CalendarKey;
  readonly ids: ReadonlyMap<string, RemoteEventId>;
}

type DeriveSnapshotRemovals = (
  listing: SnapshotListing,
  known: KnownEvents,
  withinWindow: WindowMembership,
) => readonly RemoteEventId[];

type DeriveDeltaRemovals = (listing: DeltaListing) => readonly AuthoritativeRemoval[];

type DeriveCalendarRetirements = (
  enumeration: Extract<CalendarEnumeration, { kind: "snapshot" }>,
  known: readonly CalendarKey[],
) => readonly CalendarKey[];

export type {
  DeltaListing,
  DeriveCalendarRetirements,
  DeriveDeltaRemovals,
  DeriveSnapshotRemovals,
  KnownEvents,
  SnapshotListing,
};
