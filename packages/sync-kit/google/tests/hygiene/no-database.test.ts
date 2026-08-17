import { describe, expect, test } from "vitest";
import { googleCapabilities } from "../../src/capabilities";
import { createGoogleContract } from "../../src/contract";
import { createHarness } from "../support/harness";
import { filesMatching, filesMatchingPattern, sourceFiles } from "../support/sources";

const databaseSpecifier = ["@keeper.sh", "database"].join("/");
const typeAssertion = /\bas [A-Z]|@ts-ignore|: any\b|\bany\[\]/;

describe("the adapter owns no storage and asserts no types", () => {
  test("GOOG-H1: no module imports the database package", async () => {
    const importers = await filesMatching("src", databaseSpecifier);
    const files = await sourceFiles("src");

    expect(importers).toEqual([]);
    expect(files.length).toBeGreaterThan(30);
  });

  test("GOOG-H1: no module reaches for a type assertion", async () => {
    const offenders = await filesMatchingPattern("src", typeAssertion);

    expect(offenders).toEqual([]);
  });

  test("GOOG-H1: the contract is assembled from injected dependencies alone", () => {
    const harness = createHarness();

    const contract = createGoogleContract(harness.dependencies);

    expect(contract.provider.capabilities).toEqual(googleCapabilities);
    expect(Object.keys(contract.conformance)).toHaveLength(7);
  });
});
