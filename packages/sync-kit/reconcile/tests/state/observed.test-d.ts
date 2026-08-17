import type { ChangeListing } from "@keeper.sh/sync-protocol";
import { describe, expectTypeOf, test } from "vitest";
import type { ObservedState } from "../../src/index";

type SourceOnly = Extract<ObservedState, { kind: "sourceOnly" }>;
type BothSides = Extract<ObservedState, { kind: "bothSides" }>;

describe("an orphan mirror cannot be retired on a destination we never listed", () => {
  test("RECON-O32: the sourceOnly arm exposes no destination listing", () => {
    expectTypeOf<SourceOnly["destination"]>().toEqualTypeOf<undefined>();
  });

  test("RECON-O32: the bothSides arm requires a real destination listing", () => {
    expectTypeOf<BothSides["destination"]>().toEqualTypeOf<ChangeListing>();
  });

  test("RECON-O32: a bothSides state missing its destination does not typecheck", () => {
    expectTypeOf<Omit<BothSides, "destination">>().not.toMatchTypeOf<BothSides>();
  });

  test("RECON-O32: both arms always carry a source listing", () => {
    expectTypeOf<SourceOnly["source"]>().toEqualTypeOf<ChangeListing>();
    expectTypeOf<BothSides["source"]>().toEqualTypeOf<ChangeListing>();
  });
});
