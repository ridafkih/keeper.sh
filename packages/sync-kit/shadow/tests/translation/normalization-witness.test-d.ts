import { describe, expectTypeOf, test } from "vitest";
import type {
  DestinationNormalizationWitness,
  DestinationSyncInput,
} from "../../src/index";

describe("the normalization assertion is mandatory at compile time", () => {
  test("SHADOW-I24: a translation cannot be requested without a normalization witness", () => {
    expectTypeOf<DestinationSyncInput>().toHaveProperty("normalization");
    expectTypeOf<undefined>().not.toExtend<DestinationSyncInput["normalization"]>();
    expectTypeOf<DestinationNormalizationWitness["appliedBy"]>().toEqualTypeOf<"caller">();
    expectTypeOf<DestinationNormalizationWitness["appliedBy"]>().not.toEqualTypeOf<string>();
  });
});
