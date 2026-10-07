import type { ChangeListing } from "@keeper.sh/sync-protocol";
import { describe, expectTypeOf, test } from "vitest";
import type { IcsFeedProjection, IcsFeedRequest } from "../../src/index";

type PartialListing = Extract<ChangeListing, { kind: "partial" }>;
type CursorLostListing = Extract<ChangeListing, { kind: "cursorLost" }>;
type DeltaListing = Extract<ChangeListing, { kind: "delta" }>;

describe("the only listing kind this package can construct", () => {
  test("ICAL-O40: the projection's listing is exactly the snapshot member", () => {
    expectTypeOf<IcsFeedProjection["listing"]["kind"]>().toEqualTypeOf<"snapshot">();
  });

  test("ICAL-O40: a partial, cursorLost or delta listing is not assignable to the projection", () => {
    expectTypeOf<PartialListing>().not.toMatchTypeOf<IcsFeedProjection["listing"]>();
    expectTypeOf<CursorLostListing>().not.toMatchTypeOf<IcsFeedProjection["listing"]>();
    expectTypeOf<DeltaListing>().not.toMatchTypeOf<IcsFeedProjection["listing"]>();
  });

  test("ICAL-O40: a snapshot listing always carries the coverage a deletion computation needs", () => {
    expectTypeOf<IcsFeedProjection["listing"]["coverage"]>().not.toEqualTypeOf<undefined>();
  });

  test("ICAL-I50: no request field can carry a sync token or a continuation", () => {
    expectTypeOf<keyof IcsFeedRequest>().toEqualTypeOf<
      "body" | "scope" | "previousContentHash" | "options"
    >();
  });
});
