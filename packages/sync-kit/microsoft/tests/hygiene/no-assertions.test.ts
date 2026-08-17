import { describe, expect, test } from "vitest";
import { microsoftCapabilities } from "../../src/capabilities";
import { createMicrosoftContract } from "../../src/contract";
import { createHarness } from "../support/harness";
import { filesMatching, readSource, sourceFiles } from "../support/sources";

const databaseSpecifier = ["@keeper.sh", "database"].join("/");
const typeAssertion = /\bas [A-Z]|@ts-ignore|: any\b|\bany\[\]/;
const importStatement = /^import[\s\S]*?from "[^"]+";$/gm;

const filesAssertingATypeOutsideAnImport = async (): Promise<readonly string[]> => {
  const offenders: string[] = [];
  for (const file of await sourceFiles("src")) {
    const source = await readSource(file);
    const body = source.replaceAll(importStatement, "");
    if (typeAssertion.test(body)) {
      offenders.push(file);
    }
  }
  return offenders;
};

describe("the adapter owns no storage and asserts no types", () => {
  test("MS-H7: no module imports the database package or asserts a type", async () => {
    const importers = await filesMatching("src", databaseSpecifier);
    const assertions = await filesAssertingATypeOutsideAnImport();

    const files = await sourceFiles("src");

    expect(importers).toEqual([]);
    expect(assertions).toEqual([]);
    expect(files.length).toBeGreaterThan(40);
    expect(
      Object.keys(createMicrosoftContract(createHarness().dependencies).conformance),
    ).toHaveLength(7);
  });

  test("MS-H7: the contract is assembled from injected dependencies alone", () => {
    const harness = createHarness();

    const contract = createMicrosoftContract(harness.dependencies);

    expect(contract.provider.capabilities).toEqual(microsoftCapabilities);
    expect(Object.keys(contract.conformance)).toHaveLength(7);
  });
});
