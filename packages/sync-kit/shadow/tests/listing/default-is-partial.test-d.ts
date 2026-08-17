import { describe, expectTypeOf, test } from "vitest";
import type { ChangeListing } from "@keeper.sh/sync-protocol";
import type { SynthesizedSourceListing } from "../../src/index";

type PartialListing = Extract<SynthesizedSourceListing, { kind: "partial" }>;

describe("the type system forbids an unproven listing licensing a deletion", () => {
  test("SHADOW-I1: a partial listing cannot be given a coverage or a removal", () => {
    expectTypeOf<PartialListing["coverage"]>().toEqualTypeOf<undefined>();
    expectTypeOf<PartialListing["removals"]>().toEqualTypeOf<undefined>();
    expectTypeOf<PartialListing["cursor"]>().toEqualTypeOf<undefined>();
  });

  test("SHADOW-I1: the synthesized listing is only ever partial or snapshot", () => {
    expectTypeOf<SynthesizedSourceListing["kind"]>().toEqualTypeOf<"partial" | "snapshot">();
    expectTypeOf<SynthesizedSourceListing>().toExtend<ChangeListing>();
  });
});
