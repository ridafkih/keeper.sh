import { describe, expectTypeOf, test } from "vitest";
import type { Catalog, DeletionEntry } from "../../src/index";

type NotTranslated = Extract<Catalog, { kind: "notTranslated" }>;
type PlannerRefused = Extract<Catalog, { kind: "plannerRefused" }>;
type Cataloged = Extract<Catalog, { kind: "cataloged" }>;

describe("the catalog union", () => {
  test("SHADOW-I20: a failed catalog has no deletions field", () => {
    expectTypeOf<NotTranslated["deletions"]>().toEqualTypeOf<undefined>();
    expectTypeOf<PlannerRefused["deletions"]>().toEqualTypeOf<undefined>();
    expectTypeOf<Cataloged["deletions"]>().toEqualTypeOf<readonly DeletionEntry[]>();
  });

  test("SHADOW-I20: only the refusal arms carry a reason or an invariant", () => {
    expectTypeOf<Cataloged["reason"]>().toEqualTypeOf<undefined>();
    expectTypeOf<Cataloged["invariant"]>().toEqualTypeOf<undefined>();
    expectTypeOf<PlannerRefused["invariant"]>().toEqualTypeOf<string>();
  });
});
