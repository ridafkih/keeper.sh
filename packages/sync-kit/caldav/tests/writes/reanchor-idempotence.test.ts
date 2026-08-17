import { describe, expect, test } from "vitest";
import { listingOf } from "../support/expect";
import { calendarPath } from "../support/fake-caldav";
import { createHarness, decadeWindow, operationContext, scopeOver } from "../support/harness";
import { calendarOf } from "../support/resources";

const series = calendarOf([
  {
    uid: "series@example.com",
    summary: "Weekly",
    tzid: "Europe/Berlin",
    start: "20260302T090000",
    end: "20260302T100000",
    extraLines: ["RRULE:FREQ=WEEKLY;COUNT=6", "EXDATE;TZID=Europe/Berlin:20260316T090000"],
  },
]);

describe("ingesting a recurring resource is idempotent", () => {
  test("DAV-O31: ingesting the same recurring resource twice gives the same answer", async () => {
    const harness = createHarness({
      fake: { announcesSyncCollection: false },
      resources: [{ path: `${calendarPath}series.ics`, data: series }],
    });
    const scope = scopeOver(decadeWindow);
    const context = operationContext(harness.environment, { deadlineMs: 2000 });

    const first = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));
    const second = listingOf(await harness.provider.listChanges({ scope, resume: null }, context));

    expect((second.events ?? []).map((event) => event.fingerprint.value)).toEqual(
      (first.events ?? []).map((event) => event.fingerprint.value),
    );
    expect((first.events ?? []).at(0)?.content.recurrence?.exceptions).toEqual([
      "20260316T080000Z",
    ]);
  }, 30_000);
});
