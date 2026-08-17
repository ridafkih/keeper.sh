import { describe, expect, test } from "vitest";
import { createCalDAVInternals } from "../../src/internals";
import { createHarness } from "../support/harness";
import { filesMatchingPattern } from "../support/sources";

const globalFetchCall = /(?<![.\w])fetch\s*\(/;
const moduleLevelClient = /^const\s+\w+\s*=\s*(?:await\s+)?createDAVClient\s*\(/m;

describe("the transport arrives as an argument", () => {
  test("DAV-H17: src references no global fetch and no module-level client", async () => {
    const callers = await filesMatchingPattern("src", globalFetchCall);
    const modules = await filesMatchingPattern("src", moduleLevelClient);

    expect(callers).toEqual([]);
    expect(modules).toEqual([]);
  });

  test("DAV-H17: the internals are assembled from the dependencies they are given", () => {
    const harness = createHarness();

    const internals = createCalDAVInternals(harness.dependencies);

    expect(internals.dependencies).toBe(harness.dependencies);
    expect(internals.dependencies.client).toBe(harness.dependencies.client);
  });
});
