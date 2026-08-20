import { describe, expectTypeOf, test } from "vitest";
import type {
  AccountId,
  CalendarEnumeration,
  CalendarId,
  CalendarKey,
  ChangeListing,
  Continuation,
  CoverageWindow,
  DeriveCalendarRetirements,
  ListingDiagnostics,
  ListingScope,
  Removal,
  RemoteEvent,
  SyncCursor,
  TimeWindow,
  WithheldEvent,
} from "../src/index";

declare const scope: ListingScope;
declare const calendarId: CalendarId;
declare const coverage: CoverageWindow;
declare const requestedWindow: TimeWindow;
declare const events: readonly RemoteEvent[];
declare const withheld: readonly WithheldEvent[];
declare const removals: readonly Removal[];
declare const cursor: SyncCursor;
declare const continuation: Continuation;
declare const diagnostics: ListingDiagnostics;
declare const partialEnumeration: Extract<CalendarEnumeration, { kind: "partial" }>;

declare const acceptListing: (listing: ChangeListing) => void;
declare const acceptCoverage: (window: CoverageWindow) => void;
declare const acceptSyncCursor: (token: SyncCursor) => void;
declare const acceptCalendarKey: (key: CalendarKey) => void;
declare const acceptSnapshotEnumeration: (
  enumeration: Parameters<DeriveCalendarRetirements>[0],
) => void;

describe("a listing may only authorise what it proved", () => {
  test("a partial listing can never carry removals", () => {
    // @ts-expect-error a truncated read must never delete the user's events
    acceptListing({
      kind: "partial",
      scope,
      events,
      withheld,
      continuation,
      diagnostics,
      removals,
    });
  });

  test("a partial listing carries neither a cursor nor a coverage window", () => {
    // @ts-expect-error advancing a token over a dropped page strands every event it named
    acceptListing({
      kind: "partial",
      scope,
      events,
      withheld,
      continuation,
      diagnostics,
      cursor,
    });
    // @ts-expect-error a truncated read proves no coverage
    acceptListing({
      kind: "partial",
      scope,
      events,
      withheld,
      continuation,
      diagnostics,
      coverage,
    });
  });

  test("a partial listing cannot exist without a continuation", () => {
    // @ts-expect-error without a continuation a pagination loop re-requests the same page forever
    acceptListing({ kind: "partial", scope, events, withheld, diagnostics });
    expectTypeOf<Extract<ChangeListing, { kind: "partial" }>["continuation"]>().toEqualTypeOf<
      Continuation
    >();
  });

  test("a cursorLost listing carries no events, no removals, no cursor and no coverage", () => {
    // @ts-expect-error a post-410 resync carries no tombstones, so its events prove nothing
    acceptListing({
      kind: "cursorLost",
      scope,
      diagnostics,
      events,
    });
    // @ts-expect-error a lost cursor cannot name what was removed while it was lost
    acceptListing({
      kind: "cursorLost",
      scope,
      diagnostics,
      removals,
    });
    // @ts-expect-error the token that was lost cannot be carried forward
    acceptListing({
      kind: "cursorLost",
      scope,
      diagnostics,
      cursor,
    });
    // @ts-expect-error a lost cursor proves no coverage
    acceptListing({
      kind: "cursorLost",
      scope,
      diagnostics,
      coverage,
    });
  });

  test("a snapshot listing cannot omit its coverage window", () => {
    // @ts-expect-error a snapshot without coverage claims authority it never proved
    acceptListing({ kind: "snapshot", scope, events, withheld, removals, cursor, diagnostics });
  });

  test("a cancelled event has somewhere to go in both authoritative listing kinds", () => {
    acceptListing({ kind: "snapshot", scope, coverage, events, removals, withheld, cursor, diagnostics });
    // @ts-expect-error a snapshot that cannot report cancellations must filter them, and filtering deletes
    acceptListing({ kind: "snapshot", scope, coverage, events, withheld, cursor, diagnostics });
    expectTypeOf<Removal["kind"]>().toEqualTypeOf<"deleted" | "cancelled" | "outOfScope">();
  });

  test("a requested window is not a proven coverage window", () => {
    // @ts-expect-error the range we asked for is not the range the provider returned
    acceptCoverage(requestedWindow);
    expectTypeOf<keyof CoverageWindow>().toEqualTypeOf<"covered" | "calendar">();
    expectTypeOf<keyof TimeWindow>().toEqualTypeOf<"start" | "end">();
  });

  test("a cursor cannot exist without the scope that minted it", () => {
    // @ts-expect-error replaying a cursor against a widened window never converges
    acceptSyncCursor({ kind: "syncCursor", value: "token" });
    expectTypeOf<SyncCursor["scope"]>().toEqualTypeOf<ListingScope>();
  });

  test("a partial calendar enumeration cannot retire calendars", () => {
    // @ts-expect-error a truncated calendar list must never mark a calendar unavailable
    acceptSnapshotEnumeration(partialEnumeration);
  });

  test("a calendar key is a composite that includes the owning account", () => {
    // @ts-expect-error two accounts' calendars collide unless provider and account are part of the key
    acceptCalendarKey({ calendar: { kind: "calendarId", value: "primary" } });
    expectTypeOf<CalendarKey["account"]>().toEqualTypeOf<AccountId>();
    expectTypeOf<CalendarKey>().toHaveProperty("provider");
    // @ts-expect-error the provider's own account id is not the account row this key names
    acceptCalendarKey({ provider: "google", account: "user@example.com", calendar: calendarId });
  });
});
