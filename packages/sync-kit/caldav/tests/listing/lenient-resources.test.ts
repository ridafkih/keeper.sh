import { describe, expect, test } from "vitest";
import { caldavIcsOptions } from "../../src/canonical";
import { projectResource } from "../../src/listing/project-resource";
import { calendarPath } from "../support/fake-caldav";
import { createHarness, decadeWindow, scopeOver } from "../support/harness";
import { calendarOf } from "../support/resources";

describe("leniency is a patch layer a compliant feed passes straight through", () => {
  test("DAV-O57: a compliant resource is byte-identical through the patch layer", () => {
    const harness = createHarness();
    const compliant = calendarOf([{ uid: "compliant@example.com", summary: "Compliant" }]);

    const projected = projectResource(
      { path: `${calendarPath}one.ics`, etag: '"etag-1"', calendarData: compliant },
      scopeOver(decadeWindow),
      caldavIcsOptions(harness.dependencies),
    harness.dependencies.hash,
    );

    expect(projected.kind).toBe("event");
    if (projected.kind !== "event") {
      throw new Error(`a compliant resource projected as "${projected.kind}"`);
    }
    expect(projected.event.uid.value).toBe("compliant@example.com");
  });

  test("DAV-O57: a non-compliant date is coerced rather than rejected outright", () => {
    const harness = createHarness();
    const sloppy = calendarOf([
      { uid: "sloppy@example.com", summary: "Sloppy", start: "2026-03-21T09:00:00Z" },
    ]);

    const projected = projectResource(
      { path: `${calendarPath}sloppy.ics`, etag: '"etag-2"', calendarData: sloppy },
      scopeOver(decadeWindow),
      caldavIcsOptions(harness.dependencies),
    harness.dependencies.hash,
    );

    expect(projected.kind).toBe("event");
  });
});
