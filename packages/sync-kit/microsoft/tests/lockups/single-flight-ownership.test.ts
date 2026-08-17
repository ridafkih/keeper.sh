import { describe, expect, test } from "vitest";
import { createSingleFlight } from "../../src/client/single-flight";

const neverAborts = (): AbortSignal => new AbortController().signal;

describe("a flight only ever deletes the entry it owns", () => {
  test("MS-L17: a settled flight does not delete its successor's entry", async () => {
    const flights = createSingleFlight<string>();
    const first = Promise.withResolvers<string>();
    const second = Promise.withResolvers<string>();

    const leading = flights.run("one-scope", () => first.promise, neverAborts());
    first.resolve("the first answer");
    const following = flights.run("one-scope", () => second.promise, neverAborts());
    await leading;
    const keysWhileSecondRuns = flights.inFlightKeys();
    second.resolve("the second answer");
    await following;

    expect(keysWhileSecondRuns).toEqual(["one-scope"]);
    expect(flights.inFlightKeys()).toEqual([]);
  }, 30_000);
});
