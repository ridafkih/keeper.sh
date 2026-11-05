import type { ListingScope, SyncCursor } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { calendarKeyString } from "../identity/calendar-key";
import type { ReconciliationPolicy } from "../policy";
import type { KnownState } from "../state/known";
import type { ObservedState } from "../state/observed";
import { sameTimeWindow } from "../state/time-window";
import type { CursorDecision } from "./plan";

const mintedForTheSameRequest = (
  cursor: SyncCursor,
  scope: ListingScope,
  policy: ReconciliationPolicy,
): boolean =>
  calendarKeyString(cursor.scope.calendar) === calendarKeyString(scope.calendar) &&
  cursor.scope.expandRecurrences === scope.expandRecurrences &&
  sameTimeWindow(cursor.scope.window, policy.mirrorWindow);

const decisionForOfferedCursor = (
  cursor: SyncCursor | null,
  scope: ListingScope,
  policy: ReconciliationPolicy,
): CursorDecision => {
  if (!cursor) {
    return { kind: "hold", reason: "noCursorOffered" };
  }
  if (!mintedForTheSameRequest(cursor, scope, policy)) {
    return { kind: "reset", reason: "scopeChanged" };
  }
  return { kind: "advance", cursor };
};

const decideCursor = (
  observed: ObservedState,
  known: KnownState,
  policy: ReconciliationPolicy,
): CursorDecision => {
  if (known.corrupt.length > 0) {
    return { kind: "reset", reason: "corruptKnownState" };
  }
  const listing = observed.source;
  switch (listing.kind) {
    case "cursorLost": {
      return { kind: "reset", reason: "cursorLost" };
    }
    case "partial": {
      return { kind: "hold", reason: "listingIncomplete" };
    }
    case "snapshot":
    case "delta": {
      return decisionForOfferedCursor(listing.cursor, listing.scope, policy);
    }
    default: {
      return assertNever(listing);
    }
  }
};

export { decideCursor };
