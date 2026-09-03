import type { WriteIntent } from "@keeper.sh/sync-protocol";
import { describe, expectTypeOf, test } from "vitest";

type UpdateIntent = Extract<WriteIntent, { kind: "update" }>;
type DeleteIntent = Extract<WriteIntent, { kind: "delete" }>;
type RetireIntent = Extract<WriteIntent, { kind: "retire" }>;
type CreateIntent = Extract<WriteIntent, { kind: "create" }>;

describe("an unconditional overwrite is not expressible", () => {
  test("RECON-O9: an update without a precondition does not typecheck", () => {
    expectTypeOf<Omit<UpdateIntent, "precondition">>().not.toMatchTypeOf<UpdateIntent>();
  });

  test("RECON-O9: a delete without a precondition does not typecheck", () => {
    expectTypeOf<Omit<DeleteIntent, "precondition">>().not.toMatchTypeOf<DeleteIntent>();
  });

  test("RECON-O9: a retire without a precondition does not typecheck", () => {
    expectTypeOf<Omit<RetireIntent, "precondition">>().not.toMatchTypeOf<RetireIntent>();
  });

  test("RECON-O9: the mutating intents accept only an observed precondition, never absent", () => {
    expectTypeOf<UpdateIntent["precondition"]>().not.toMatchTypeOf<{ kind: "absent" }>();
    expectTypeOf<DeleteIntent["precondition"]>().not.toMatchTypeOf<{ kind: "absent" }>();
  });

  test("RECON-O9: a create carries the absent precondition and nothing else", () => {
    expectTypeOf<CreateIntent["precondition"]>().toEqualTypeOf<{ readonly kind: "absent" }>();
  });
});
