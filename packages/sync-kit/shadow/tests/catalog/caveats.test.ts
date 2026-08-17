import { describe, expect, test } from "vitest";
import { catalogCaveats, defaultShadowLimits, renderCatalog } from "../../src/index";
import { catalogOfPlan, cataloged, runShadow } from "../support/scenario";
import { planWith } from "../support/plans";
import {
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  sourceCalendarA,
  sourceCalendarB,
  storedCoverage,
  storedSourceEvent,
  syncInput,
  witnessFor,
} from "../support/fixtures";

const identity = slotIdentity("evt-one", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const other = slotIdentity("evt-two", "2026-03-11T09:00:00.000Z", "2026-03-11T10:00:00.000Z");

const singleSourceCatalog = () => cataloged(catalogOfPlan([identity], planWith({})));

const mapped = [sourceCalendarA, sourceCalendarB];

const multiSourceCatalog = () =>
  cataloged(
    runShadow(
      syncInput({
        mappedSourceCalendars: mapped,
        witness: witnessFor(mapped),
        storedCoverage: [
          storedCoverage({ calendar: sourceCalendarA }),
          storedCoverage({ calendar: sourceCalendarB }),
        ],
        storedSourceEvents: [
          storedSourceEvent({ identity, sourceCalendar: sourceCalendarA }),
          storedSourceEvent({ identity: other, sourceCalendar: sourceCalendarB }),
        ],
        mirrors: [
          mirrorRow({ identity, sourceCalendar: sourceCalendarA }),
          mirrorRow({ identity: other, sourceCalendar: sourceCalendarB }),
        ],
        destinationListing: destinationSnapshot({
          events: [
            ownMirrorEvent({ id: "mirror-evt-one", uid: "evt-one" }),
            ownMirrorEvent({ id: "mirror-evt-two", uid: "evt-two" }),
          ],
        }),
      }),
      shadowOptions(),
    ),
  );

const staleCatalog = () =>
  cataloged(
    runShadow(
      syncInput({
        storedSourceEvents: [storedSourceEvent({ identity })],
        mirrors: [mirrorRow({ identity })],
        storedCoverage: [storedCoverage({ recordedAt: "2026-05-01T00:00:00.000Z" })],
      }),
      shadowOptions(),
    ),
  );

describe("the catalog states its caveats", () => {
  test("SHADOW-I8: every catalog carries the no-removal-signal caveat", () => {
    expect(singleSourceCatalog().caveats).toContain("noSourceRemovalSignal");
    expect(multiSourceCatalog().caveats).toContain("noSourceRemovalSignal");
  });

  test("SHADOW-I10: suppressing the mirror-window path emits its caveat", () => {
    expect(singleSourceCatalog().caveats).toContain("mirrorWindowRetirementSuppressed");
  });

  test("SHADOW-I6: a stale downgrade emits the under-reporting caveat by name", () => {
    const { caveats } = staleCatalog();

    expect(caveats).toContain("coverageStalerThanTheLiveEngineAccepts");
    expect(caveats).toContain("underReportsRelativeToLiveEngine");
  });

  test("SHADOW-I6: a fresh recording does not emit the staleness caveat", () => {
    expect(singleSourceCatalog().caveats).not.toContain(
      "coverageStalerThanTheLiveEngineAccepts",
    );
  });

  test("SHADOW-I22: a multi-source run emits the cross-source caveat", () => {
    expect(multiSourceCatalog().caveats).toContain("crossSourceInteractionsInvisible");
    expect(singleSourceCatalog().caveats).not.toContain("crossSourceInteractionsInvisible");
  });

  test("SHADOW-I34: every caveat is reachable and renders by name", () => {
    const seen = new Set([
      ...singleSourceCatalog().caveats,
      ...multiSourceCatalog().caveats,
      ...staleCatalog().caveats,
    ]);

    for (const caveat of catalogCaveats) {
      expect([...seen]).toContain(caveat);
    }
    expect(renderCatalog(staleCatalog(), defaultShadowLimits)["shadow.caveats"]).toContain(
      "coverageStalerThanTheLiveEngineAccepts",
    );
  });

  test("SHADOW-I34: no catalog claims parity with the existing engine", () => {
    const rendered = renderCatalog(singleSourceCatalog(), defaultShadowLimits);
    const serialised = JSON.stringify(rendered);

    expect(serialised).not.toContain("parity");
    expect(serialised).not.toContain("equivalent");
    expect(serialised).not.toContain("matches_live");
    expect(Object.hasOwn(rendered, "shadow.caveats")).toBe(true);
  });
});
