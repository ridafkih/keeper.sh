import { describe, expectTypeOf, test } from "vitest";
import type { SourceReadWitness } from "../../src/index";

describe("pre-read coverage cannot be expressed", () => {
  test("SHADOW-I7: a witness cannot say the coverage was not narrowed", () => {
    expectTypeOf<SourceReadWitness["coverageNarrowedAfterRemoteRead"]>().toEqualTypeOf<true>();
    expectTypeOf<SourceReadWitness["coverageNarrowedAfterRemoteRead"]>().not.toEqualTypeOf<boolean>();
  });

  test("SHADOW-I7: both source calendar sets are required, not optional", () => {
    expectTypeOf<SourceReadWitness>().toHaveProperty("sourceCalendarsBeforeRemoteRead");
    expectTypeOf<SourceReadWitness>().toHaveProperty("sourceCalendarsAtLocalRead");
    expectTypeOf<undefined>().not.toExtend<
      SourceReadWitness["sourceCalendarsBeforeRemoteRead"]
    >();
    expectTypeOf<undefined>().not.toExtend<SourceReadWitness["sourceCalendarsAtLocalRead"]>();
  });
});
