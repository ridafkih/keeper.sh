import { describe, expect, test } from "vitest";
import { projectIcsFeed } from "../../src/index";
import { calendarWith, testScope, vevent } from "../support/feed";
import { testOptions } from "../support/options";

const maxDiagnosticSample = 5;

const unbuildable = (index: number): readonly string[] =>
  vevent({
    uid: `evt-bad-${index}`,
    lines: ["DTSTAMP:20260101T000000Z", "DTSTART:20260310T090000Z", "DURATION:-PT1H"],
  });

const feedWith = (count: number): string =>
  calendarWith(Array.from({ length: count }, (_unused, index) => [...unbuildable(index)]).flat());

const project = (count: number) =>
  projectIcsFeed({
    body: feedWith(count),
    scope: testScope,
    previousContentHash: null,
    options: testOptions({ limits: { maxDiagnosticSample } }),
  });

describe("diagnostics on a feed that publishes malformed events everywhere", () => {
  test("ICAL-I12: the identifier list is capped at maxDiagnosticSample", () => {
    const projection = project(200);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.listing.diagnostics.withheld.sample).toHaveLength(maxDiagnosticSample);
  });

  test("ICAL-I12: the uncapped total sits beside the capped sample", () => {
    const projection = project(200);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.listing.diagnostics.withheld.total).toBe(200);
  });

  test("ICAL-I12: at the boundary the sample is complete and the total agrees", () => {
    const projection = project(maxDiagnosticSample);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.listing.diagnostics.withheld.sample).toHaveLength(maxDiagnosticSample);
    expect(projection.value.listing.diagnostics.withheld.total).toBe(maxDiagnosticSample);
  });

  test("ICAL-I3: capping the diagnostic sample never caps the presence set", () => {
    const projection = project(200);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.present).toHaveLength(200);
    expect(projection.value.unsupported).toHaveLength(200);
  });

  test("ICAL-I12: the sample is stable across two identical polls", () => {
    const first = project(200);
    const second = project(200);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      return;
    }
    expect(second.value.listing.diagnostics.withheld.sample).toEqual(
      first.value.listing.diagnostics.withheld.sample,
    );
  });
});
