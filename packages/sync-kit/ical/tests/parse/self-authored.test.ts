import { describe, expect, test } from "vitest";
import { projectIcsFeed } from "../../src/index";
import { calendarWith, simpleEvent, testScope, vevent } from "../support/feed";
import { testInstallation, testOptions } from "../support/options";

const ourEvent = (suffix: string): readonly string[] =>
  vevent({
    uid: `mirror-${suffix}@${testInstallation.value}.keeper.sh`,
    lines: [
      "DTSTAMP:20260310T080000Z",
      "DTSTART:20260310T090000Z",
      "DTEND:20260310T100000Z",
      `X-KEEPER-INSTALLATION:${testInstallation.value}`,
      "SUMMARY:mirrored by us",
    ],
  });

const purelySelfAuthoredFeed = calendarWith([...ourEvent("a"), ...ourEvent("b"), ...ourEvent("c")]);

const mixedFeed = calendarWith([
  ...ourEvent("a"),
  ...simpleEvent("evt-foreign", "20260311T090000Z", "20260311T100000Z"),
]);

const project = (body: string) =>
  projectIcsFeed({ body, scope: testScope, previousContentHash: null, options: testOptions() });

describe("a feed carrying our own provenance", () => {
  test("ICAL-O12: a feed of purely self-authored events yields zero usable events", () => {
    const projection = project(purelySelfAuthoredFeed);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable).toEqual([]);
  });

  test("ICAL-O12: the self-authored count matches the event count and is separate from unrepresentable", () => {
    const projection = project(purelySelfAuthoredFeed);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.listing.diagnostics.selfAuthored.total).toBe(3);
    expect(projection.value.listing.diagnostics.unrepresentable.total).toBe(0);
    expect(projection.value.listing.diagnostics.withheld.total).toBe(0);
  });

  test("ICAL-O13: a self-authored event is still present, so the next diff cannot delete our own mirror", () => {
    const projection = project(purelySelfAuthoredFeed);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.present).toHaveLength(3);
  });

  test("ICAL-O13: a foreign event beside ours is usable, so the skip is not a whole-feed refusal", () => {
    const projection = project(mixedFeed);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable.map((identity) => identity.uid.value)).toEqual(["evt-foreign"]);
    expect(projection.value.present).toHaveLength(2);
  });

  test("ICAL-I37: another installation's stamp is foreign, not ours", () => {
    const otherInstallation = { kind: "installationId", value: "inst-other" } as const;
    const projection = projectIcsFeed({
      body: purelySelfAuthoredFeed,
      scope: testScope,
      previousContentHash: null,
      options: testOptions({ installation: otherInstallation }),
    });

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable).toHaveLength(3);
    expect(projection.value.listing.diagnostics.selfAuthored.total).toBe(0);
  });

  test("ICAL-O13: a self-authored event is named on the listing a deletion is derived from", () => {
    const projection = project(purelySelfAuthoredFeed);

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.listing.withheld).toHaveLength(3);
    expect(projection.value.listing.withheld.every((entry) => entry.reason === "selfAuthored")).toBe(
      true,
    );
  });

  test("ICAL-I37: an event carrying our provenance is emitted as ours, never laundered into foreign", () => {
    const projection = projectIcsFeed({
      body: purelySelfAuthoredFeed,
      scope: testScope,
      previousContentHash: null,
      options: testOptions({ selfAuthored: "includeForRoundTrip" }),
    });

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.listing.events.map((event) => event.provenance.kind)).toEqual([
      "ours",
      "ours",
      "ours",
    ]);
  });

  test("ICAL-I37: includeForRoundTrip makes our own events usable without changing presence", () => {
    const projection = projectIcsFeed({
      body: purelySelfAuthoredFeed,
      scope: testScope,
      previousContentHash: null,
      options: testOptions({ selfAuthored: "includeForRoundTrip" }),
    });

    expect(projection.ok).toBe(true);
    if (!projection.ok) {
      return;
    }
    expect(projection.value.usable).toHaveLength(3);
    expect(projection.value.present).toHaveLength(3);
  });
});
