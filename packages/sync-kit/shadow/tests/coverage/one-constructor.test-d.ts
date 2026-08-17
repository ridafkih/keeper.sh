import { describe, expectTypeOf, test } from "vitest";
import type { CoverageWindow } from "@keeper.sh/sync-protocol";
import type { ProvenCoverage } from "@keeper.sh/sync-reconcile";
import type {
  CoverageProofRequest,
  PolicyRequest,
  SourceListingRequest,
} from "../../src/index";
import { sourceCoverageFrom } from "../../src/index";

describe("coverage has exactly one constructor", () => {
  test("SHADOW-I2: no public function accepts a listing coverage and a policy coverage separately", () => {
    expectTypeOf<SourceListingRequest>().not.toHaveProperty("coverage");
    expectTypeOf<SourceListingRequest>().not.toHaveProperty("coverageWindow");
    expectTypeOf<SourceListingRequest>().not.toHaveProperty("coverageBySource");
    expectTypeOf<PolicyRequest>().not.toHaveProperty("coverageBySource");
    expectTypeOf<PolicyRequest>().not.toHaveProperty("coverage");
    expectTypeOf<SourceListingRequest["proof"]>().toEqualTypeOf<
      ReturnType<typeof sourceCoverageFrom>
    >();
  });

  test("SHADOW-I2: the one constructor takes the recorded row, the mirror window and the clock", () => {
    expectTypeOf<CoverageProofRequest>().toHaveProperty("stored");
    expectTypeOf<CoverageProofRequest>().toHaveProperty("mirrorWindow");
    expectTypeOf<CoverageProofRequest>().toHaveProperty("asOf");
    expectTypeOf<CoverageProofRequest>().toHaveProperty("maxCoverageAgeSeconds");
    expectTypeOf<CoverageProofRequest>().not.toMatchObjectType<{ coverage: CoverageWindow }>();
    expectTypeOf<CoverageProofRequest>().not.toMatchObjectType<{ proven: ProvenCoverage }>();
  });
});
