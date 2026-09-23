import { describe, expectTypeOf, test } from "vitest";
import type { ApplicablePlan, Plan } from "../../src/index";

describe("the applier's input is the plan without its cursor", () => {
  test("RECON-O27: a plan minus its cursor still typechecks as the applier's input", () => {
    expectTypeOf<Omit<Plan, "cursor">>().toEqualTypeOf<ApplicablePlan>();
  });

  test("RECON-O27: the applicable plan exposes no cursor field to write by accident", () => {
    expectTypeOf<ApplicablePlan>().not.toHaveProperty("cursor");
  });

  test("RECON-O27: the applicable plan still carries every write and tombstone", () => {
    expectTypeOf<ApplicablePlan>().toHaveProperty("writes");
    expectTypeOf<ApplicablePlan>().toHaveProperty("tombstones");
  });

  test("RECON-I17: the cursor decision is a sibling field, not nested inside the writes", () => {
    expectTypeOf<Plan["cursor"]>().not.toEqualTypeOf<undefined>();
  });
});
