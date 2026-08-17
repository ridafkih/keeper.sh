import { describe, expect, test } from "vitest";
import { caldavLimits } from "../../src/limits";
import { cursorOf, listingOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import type { Harness } from "../support/harness";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { manyResources, singleEventResource } from "../support/resources";

const touchAll = (harness: Harness, count: number): void => {
  for (let index = 0; index < count; index += 1) {
    const path = `${calendarPath}bulk-${index}.ics`;
    harness.fake.put(path, harness.fake.resourceAt(path)?.data ?? "");
  }
};

describe("an always-truncating server cannot page forever", () => {
  test("DAV-L1: a sync-collection walk that answers 507 forever stops at the page ceiling", async () => {
    const resources = manyResources(caldavLimits.syncPageCeiling * 4);
    const harness = createHarness({ resources: [...resources] });
    const scope = scopeOver(decadeWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));
    touchAll(harness, resources.length);
    harness.fake.configure({ truncatesAfter: 1 });

    const walked = listingOf(
      await harness.provider.listChanges({ scope, resume: cursorOf(first) }, context),
    );

    expect(walked.kind).toBe("partial");
    expect(harness.fake.reportsOf("sync-collection").length).toBe(caldavLimits.syncPageCeiling);
  }, 30_000);

  test("DAV-L1: a walk that runs out of changes stops before the ceiling, so the ceiling is the bound and not the algorithm", async () => {
    const shortOfTheCeiling = caldavLimits.syncPageCeiling - 2;
    const resources = manyResources(shortOfTheCeiling);
    const harness = createHarness({ resources: [...resources] });
    const scope = scopeOver(decadeWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });
    const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));
    touchAll(harness, resources.length);
    harness.fake.configure({ truncatesAfter: 1 });

    const walked = listingOf(
      await harness.provider.listChanges({ scope, resume: cursorOf(first) }, context),
    );

    expect(walked.kind).toBe("delta");
    expect(harness.fake.reportsOf("sync-collection").length).toBe(shortOfTheCeiling);
  }, 30_000);

  test("DAV-L1: a truncated enumeration is answered as partial rather than paged forever", async () => {
    const harness = createHarness({
      fake: { truncatesAfter: 2 },
      resources: [...manyResources(6), singleEventResource("extra.ics", { uid: "extra" })],
    });

    const listed = listingOf(
      await harness.provider.listChanges(
        { scope: scopeOver(decadeWindow), resume: null },
        operationContext(harness.environment, { deadlineMs: 2000 }),
      ),
    );

    expect(listed.kind).toBe("partial");
    expect(harness.fake.requestsOf("PROPFIND").length).toBeLessThan(caldavLimits.syncPageCeiling);
  }, 30_000);
});
