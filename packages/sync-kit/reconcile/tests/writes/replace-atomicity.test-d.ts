import { describe, expectTypeOf, test } from "vitest";
import type { PlannedWrite } from "../../src/index";

type SingleWrite = Extract<PlannedWrite, { kind: "single" }>;
type ReplaceWrite = Extract<PlannedWrite, { kind: "replace" }>;

describe("a replace is one entry, never two", () => {
  test("RECON-O16: the replace arm carries both halves and neither is optional", () => {
    expectTypeOf<ReplaceWrite["retire"]>().not.toEqualTypeOf<undefined>();
    expectTypeOf<ReplaceWrite["recreate"]>().not.toEqualTypeOf<undefined>();
  });

  test("RECON-O16: a replace missing its recreate does not typecheck", () => {
    expectTypeOf<Omit<ReplaceWrite, "recreate">>().not.toMatchTypeOf<ReplaceWrite>();
  });

  test("RECON-O16: a replace missing its retire does not typecheck", () => {
    expectTypeOf<Omit<ReplaceWrite, "retire">>().not.toMatchTypeOf<ReplaceWrite>();
  });

  test("RECON-O16: the single arm cannot smuggle a retire/recreate pair", () => {
    expectTypeOf<SingleWrite["retire"]>().toEqualTypeOf<undefined>();
    expectTypeOf<SingleWrite["recreate"]>().toEqualTypeOf<undefined>();
  });
});
