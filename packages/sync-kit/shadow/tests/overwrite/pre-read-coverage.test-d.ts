import { describe, expectTypeOf, test } from "vitest";
import type { SourceReadWitness } from "../../src/index";

describe("a pre-read witness is not expressible", () => {
  test("SHADOW-O20: a witness with coverageNarrowedAfterRemoteRead false does not compile", () => {
    const unnarrowed: SourceReadWitness = {
      sourceCalendarsBeforeRemoteRead: [],
      sourceCalendarsAtLocalRead: [],
      // @ts-expect-error a witness may not claim the coverage was left un-narrowed
      coverageNarrowedAfterRemoteRead: false,
    };

    expectTypeOf<typeof unnarrowed>().toExtend<SourceReadWitness>();

    expectTypeOf<SourceReadWitness["coverageNarrowedAfterRemoteRead"]>().toEqualTypeOf<true>();
  });

  test("SHADOW-O20: the witness cannot be omitted from a boolean-typed field either", () => {
    expectTypeOf<false>().not.toExtend<
      SourceReadWitness["coverageNarrowedAfterRemoteRead"]
    >();
  });
});
