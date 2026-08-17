import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { createHarness, marchWindow, operationContext, scopeOver } from "../support/harness";
import { manyForeignEvents, seedOf } from "../support/items";
import { filesMatching, sourceFiles } from "../support/sources";

const consoleWrite = ["console", "log"].join(".");
const telemetryPackage = ["@keeper.sh", "otelemetry"].join("/");

describe("the adapter emits nothing; diagnostics are returned as data", () => {
  test("MS-H4: no module imports a logger or writes to console", async () => {
    const harness = createHarness();
    harness.fake.seedFromProvider(seedOf(manyForeignEvents(2)));

    const listing = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(marchWindow), resume: null },
        operationContext(harness.environment),
      ),
    );

    const writers = await filesMatching("src", consoleWrite);
    const loggers = await filesMatching("src", telemetryPackage);
    const files = await sourceFiles("src");

    expect(writers).toEqual([]);
    expect(loggers).toEqual([]);
    expect(files.length).toBeGreaterThan(40);
    expect(listing.diagnostics.pagesFetched).toBeGreaterThan(0);
  }, 30_000);
});
