import { describe, expectTypeOf, test } from "vitest";
import type { ProvenCoverage } from "../../src/index";

type Unproven = Extract<ProvenCoverage, { kind: "unproven" }>;
type Proven = Extract<ProvenCoverage, { kind: "proven" }>;

describe("coverage is a union, never a nullable window", () => {
  test("RECON-I3: the unproven arm carries no windows to read by accident", () => {
    expectTypeOf<Unproven>().not.toHaveProperty("historic");
    expectTypeOf<Unproven>().not.toHaveProperty("future");
  });

  test("RECON-I4: the proven arm carries both axes, separately", () => {
    expectTypeOf<Proven>().toHaveProperty("historic");
    expectTypeOf<Proven>().toHaveProperty("future");
  });

  test("RECON-I3: coverage is never expressible as null", () => {
    expectTypeOf<null>().not.toMatchTypeOf<ProvenCoverage>();
  });
});
