import { describe, expectTypeOf, test } from "vitest";
import type {
  AuthoritativeRemoval,
  ChangeListing,
  CoverageWindow,
  DeriveDeltaRemovals,
  DeriveSnapshotRemovals,
  KnownEvents,
  ListingDiagnostics,
  ListingScope,
  Removal,
  RemoteEvent,
  RemoteEventId,
  SyncCursor,
  WindowMembership,
  WithheldEvent,
} from "../src/index";

declare const partialListing: Extract<ChangeListing, { kind: "partial" }>;
declare const cursorLostListing: Extract<ChangeListing, { kind: "cursorLost" }>;
declare const deltaListing: Extract<ChangeListing, { kind: "delta" }>;
declare const scope: ListingScope;
declare const coverage: CoverageWindow;
declare const events: readonly RemoteEvent[];
declare const removals: readonly Removal[];
declare const cursor: SyncCursor;
declare const diagnostics: ListingDiagnostics;
declare const outOfScopeRemovals: readonly Extract<Removal, { kind: "outOfScope" }>[];
declare const uidKeyedIds: ReadonlySet<string>;

declare const acceptSnapshotListing: (listing: Parameters<DeriveSnapshotRemovals>[0]) => void;
declare const acceptKnownEvents: (known: KnownEvents) => void;
declare const applyDeletions: (removals: readonly AuthoritativeRemoval[]) => void;

describe("deletion authority is the signature, not a runtime check", () => {
  test("DeriveSnapshotRemovals rejects a partial listing", () => {
    // @ts-expect-error an unproven read must never reach a deletion
    acceptSnapshotListing(partialListing);
  });

  test("DeriveSnapshotRemovals rejects a cursorLost listing", () => {
    // @ts-expect-error a post-410 resync names no tombstones, so it authorises no deletion
    acceptSnapshotListing(cursorLostListing);
  });

  test("a delta listing cannot express delete-everything-not-listed", () => {
    // @ts-expect-error absence in a delta feed means unchanged, never gone
    acceptSnapshotListing(deltaListing);
    expectTypeOf<Parameters<DeriveDeltaRemovals>["length"]>().toEqualTypeOf<1>();
  });

  test("the only coverage window a snapshot removal can use is the one the listing proved", () => {
    expectTypeOf<Parameters<DeriveSnapshotRemovals>[1]>().toEqualTypeOf<KnownEvents>();
    expectTypeOf<Parameters<DeriveSnapshotRemovals>[2]>().toEqualTypeOf<WindowMembership>();
    expectTypeOf<Parameters<DeriveSnapshotRemovals>["length"]>().toEqualTypeOf<3>();
    expectTypeOf<Parameters<DeriveSnapshotRemovals>[0]["coverage"]>().toEqualTypeOf<
      CoverageWindow
    >();
    expectTypeOf<Parameters<DeriveSnapshotRemovals>>().not.toExtend<
      [unknown, CoverageWindow, unknown]
    >();
  });

  test("the known set is keyed by the provider's own event ids, not by UID", () => {
    expectTypeOf<KnownEvents["ids"]>().toEqualTypeOf<ReadonlyMap<string, RemoteEventId>>();
    // @ts-expect-error a set of UIDs matches nothing in the listing, so everything reads as gone
    acceptKnownEvents({ calendar: scope.calendar, ids: uidKeyedIds });
  });

  test("an outOfScope removal never drives a deletion", () => {
    expectTypeOf<ReturnType<DeriveDeltaRemovals>>().toEqualTypeOf<readonly AuthoritativeRemoval[]>();
    // @ts-expect-error an event that merely left the window is still live on the calendar
    applyDeletions(outOfScopeRemovals);
  });

  test("a cancellation is deletion evidence in its own right", () => {
    expectTypeOf<AuthoritativeRemoval["kind"]>().toEqualTypeOf<"deleted" | "cancelled">();
    applyDeletions([{ kind: "cancelled", id: { kind: "remoteEventId", value: "evt" }, uid: { kind: "eventUid", value: "uid" } }]);
  });

  test("withheld ids are part of the deletion-inference input", () => {
    expectTypeOf<Parameters<DeriveSnapshotRemovals>[0]["withheld"]>().toEqualTypeOf<
      readonly WithheldEvent[]
    >();
    // @ts-expect-error an adapter cannot build a listing without answering what it withheld
    acceptSnapshotListing({
      kind: "snapshot",
      scope,
      coverage,
      events,
      removals,
      cursor,
      diagnostics,
    });
  });
});
