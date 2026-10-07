import type { CalendarKey } from "./calendar-ref";
import type { ListingDiagnostics, WithheldEvent } from "./diagnostics";
import type { EventUid, RemoteEventId } from "./handles";
import type { RemoteEvent } from "./remote-event";
import type { CoverageWindow, TimeWindow } from "./time";

interface ListingScope {
  readonly calendar: CalendarKey;
  readonly window: TimeWindow;
  readonly expandRecurrences: boolean;
}

interface SyncCursor {
  readonly kind: "syncCursor";
  readonly value: string;
  readonly scope: ListingScope;
}

interface Continuation {
  readonly kind: "continuation";
  readonly value: string;
  readonly scope: ListingScope;
}

type Removal =
  | { readonly kind: "deleted"; readonly id: RemoteEventId; readonly uid: EventUid }
  | { readonly kind: "cancelled"; readonly id: RemoteEventId; readonly uid: EventUid }
  | { readonly kind: "outOfScope"; readonly id: RemoteEventId };

type AuthoritativeRemoval = Extract<Removal, { kind: "deleted" } | { kind: "cancelled" }>;

type ChangeListing =
  | {
      readonly kind: "snapshot";
      readonly scope: ListingScope;
      readonly coverage: CoverageWindow;
      readonly events: readonly RemoteEvent[];
      readonly removals: readonly Removal[];
      readonly withheld: readonly WithheldEvent[];
      readonly cursor: SyncCursor | null;
      readonly diagnostics: ListingDiagnostics;
      readonly continuation?: never;
    }
  | {
      readonly kind: "delta";
      readonly scope: ListingScope;
      readonly coverage: CoverageWindow;
      readonly events: readonly RemoteEvent[];
      readonly removals: readonly Removal[];
      readonly withheld: readonly WithheldEvent[];
      readonly cursor: SyncCursor;
      readonly diagnostics: ListingDiagnostics;
      readonly continuation?: never;
    }
  | {
      readonly kind: "partial";
      readonly scope: ListingScope;
      readonly events: readonly RemoteEvent[];
      readonly withheld: readonly WithheldEvent[];
      readonly continuation: Continuation;
      readonly diagnostics: ListingDiagnostics;
      readonly coverage?: never;
      readonly removals?: never;
      readonly cursor?: never;
    }
  | {
      readonly kind: "cursorLost";
      readonly scope: ListingScope;
      readonly diagnostics: ListingDiagnostics;
      readonly coverage?: never;
      readonly events?: never;
      readonly withheld?: never;
      readonly removals?: never;
      readonly cursor?: never;
      readonly continuation?: never;
    };

export type {
  AuthoritativeRemoval,
  ChangeListing,
  Continuation,
  ListingScope,
  Removal,
  SyncCursor,
};
