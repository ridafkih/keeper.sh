import type { WriteIntent } from "@keeper.sh/sync-protocol";
import { describe, expectTypeOf, test } from "vitest";

type GoogleUpdate = Extract<WriteIntent<"google">, { kind: "update" }>;
type GoogleDelete = Extract<WriteIntent<"google">, { kind: "delete" }>;
type GoogleRetire = Extract<WriteIntent<"google">, { kind: "retire" }>;
type GoogleCreate = Extract<WriteIntent<"google">, { kind: "create" }>;

describe("an unconditional write to Google is not expressible", () => {
  test("GOOG-O39: an update without a precondition does not type-check", () => {
    expectTypeOf<Omit<GoogleUpdate, "precondition">>().not.toMatchTypeOf<GoogleUpdate>();
  });

  test("GOOG-O39: a delete and a retire without a precondition do not type-check", () => {
    expectTypeOf<Omit<GoogleDelete, "precondition">>().not.toMatchTypeOf<GoogleDelete>();
    expectTypeOf<Omit<GoogleRetire, "precondition">>().not.toMatchTypeOf<GoogleRetire>();
  });

  test("GOOG-O39: a mutating intent never accepts the absent precondition", () => {
    expectTypeOf<GoogleUpdate["precondition"]>().not.toMatchTypeOf<{ kind: "absent" }>();
    expectTypeOf<GoogleDelete["precondition"]>().not.toMatchTypeOf<{ kind: "absent" }>();
  });

  test("GOOG-O39: a create carries the absent precondition and an idempotency key", () => {
    expectTypeOf<GoogleCreate["precondition"]>().toEqualTypeOf<{ readonly kind: "absent" }>();
    expectTypeOf<GoogleCreate["idempotencyKey"]["value"]>().toEqualTypeOf<string>();
  });
});
