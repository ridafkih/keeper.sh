import { describe, expectTypeOf, test } from "vitest";
import type { DeleteHandle, ObservedPrecondition } from "@keeper.sh/sync-protocol";
import type { Tombstone } from "@keeper.sh/sync-reconcile";
import type { Catalog, DeletionEntry, ForgottenRowEntry } from "../../src/index";

type CatalogedCatalog = Extract<Catalog, { kind: "cataloged" }>;
type ForgetTombstone = Extract<Tombstone, { kind: "forgetKnownRow" }>;

describe("the deletions field is handle-bearing by type", () => {
  test("SHADOW-I12: the deletions field cannot hold a tombstone without a handle", () => {
    expectTypeOf<CatalogedCatalog["deletions"]>().toEqualTypeOf<readonly DeletionEntry[]>();
    expectTypeOf<DeletionEntry["deleteHandle"]>().toEqualTypeOf<DeleteHandle>();
    expectTypeOf<DeletionEntry["preconditionKind"]>().toEqualTypeOf<
      ObservedPrecondition["kind"]
    >();
    expectTypeOf<ForgetTombstone>().not.toExtend<DeletionEntry>();
    expectTypeOf<ForgottenRowEntry>().not.toHaveProperty("deleteHandle");
    expectTypeOf<ForgottenRowEntry>().not.toHaveProperty("preconditionKind");
  });
});
