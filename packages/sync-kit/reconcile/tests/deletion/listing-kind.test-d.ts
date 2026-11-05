import type { ChangeListing } from "@keeper.sh/sync-protocol";
import { describe, expectTypeOf, test } from "vitest";

type PartialListing = Extract<ChangeListing, { kind: "partial" }>;
type CursorLostListing = Extract<ChangeListing, { kind: "cursorLost" }>;
type SnapshotListing = Extract<ChangeListing, { kind: "snapshot" }>;

describe("listing kinds that cannot license a deletion", () => {
  test("RECON-I1: a partial listing declares no coverage and no removals", () => {
    expectTypeOf<PartialListing["coverage"]>().toEqualTypeOf<undefined>();
    expectTypeOf<PartialListing["removals"]>().toEqualTypeOf<undefined>();
  });

  test("RECON-I1: a cursorLost listing declares no events at all", () => {
    expectTypeOf<CursorLostListing["events"]>().toEqualTypeOf<undefined>();
    expectTypeOf<CursorLostListing["coverage"]>().toEqualTypeOf<undefined>();
  });

  test("RECON-I1: only a snapshot carries the coverage a set difference would need", () => {
    expectTypeOf<SnapshotListing["coverage"]>().not.toEqualTypeOf<undefined>();
  });
});
