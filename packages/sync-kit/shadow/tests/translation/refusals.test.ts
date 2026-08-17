import { describe, expect, test } from "vitest";
import type { TranslationRefusal } from "../../src/index";
import { translateDestinationSync, translationRefusals } from "../../src/index";
import { instant } from "../support/handles";
import {
  mirrorRow,
  otherCalendar,
  shadowOptions,
  slotIdentity,
  sourceCalendarA,
  sourceCalendarB,
  storedCoverage,
  storedSourceEvent,
  syncInput,
  witnessFor,
  zeroedCounters,
} from "../support/fixtures";

const identity = slotIdentity("evt-one", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const twin = slotIdentity("evt-one", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");
const oddInstant = slotIdentity("evt-odd", "2026-03-10T09:00:00Z", "2026-03-10T10:00:00.000Z");

const refusalOf = (input: Parameters<typeof translateDestinationSync>[0]): TranslationRefusal => {
  const translation = translateDestinationSync(input, shadowOptions());
  if (translation.kind !== "refused") {
    throw new Error(`expected a refusal, got a ${translation.kind} translation`);
  }
  return translation.reason;
};

const inputsByRefusal: ReadonlyMap<TranslationRefusal, () => Parameters<typeof translateDestinationSync>[0]> =
  new Map([
    [
      "noMappedSourceCalendars",
      () => syncInput({ mappedSourceCalendars: [], witness: witnessFor([]), storedCoverage: [] }),
    ],
    [
      "sourceCalendarSetChangedDuringRead",
      () =>
        syncInput({
          witness: {
            sourceCalendarsBeforeRemoteRead: [sourceCalendarA],
            sourceCalendarsAtLocalRead: [sourceCalendarA, sourceCalendarB],
            coverageNarrowedAfterRemoteRead: true,
          },
        }),
    ],
    [
      "unnormalizedLocalEvents",
      () =>
        syncInput({
          storedSourceEvents: [storedSourceEvent({ identity, canonical: null })],
          mirrors: [mirrorRow({ identity })],
        }),
    ],
    [
      "normalizedForAnotherProvider",
      () => syncInput({ normalization: { appliedBy: "caller", provider: "google" } }),
    ],
    [
      "nonCanonicalInstant",
      () =>
        syncInput({
          storedSourceEvents: [storedSourceEvent({ identity: oddInstant })],
          mirrors: [mirrorRow({ identity: oddInstant })],
        }),
    ],
    [
      "mirrorWindowInverted",
      () =>
        syncInput({
          mirrorWindow: {
            start: instant("2026-12-31T00:00:00.000Z"),
            end: instant("2026-01-01T00:00:00.000Z"),
          },
        }),
    ],
    [
      "destinationListingIsNotThisDestination",
      () =>
        syncInput({
          destinationListing: {
            kind: "cursorLost",
            scope: {
              calendar: otherCalendar,
              window: {
                start: instant("2026-01-01T00:00:00.000Z"),
                end: instant("2026-12-31T00:00:00.000Z"),
              },
              expandRecurrences: false,
            },
            diagnostics: {
              withheld: { sample: [], total: 0 },
              selfAuthored: { sample: [], total: 0 },
              unrepresentable: { sample: [], total: 0 },
              pagesFetched: 1,
            },
          },
        }),
    ],
    [
      "mirrorPointsAtAnotherDestination",
      () => syncInput({ mirrors: [mirrorRow({ identity, destinationCalendar: otherCalendar })] }),
    ],
    [
      "duplicateSourceIdentityClaim",
      () =>
        syncInput({
          mirrors: [
            mirrorRow({ identity, destinationId: "mirror-one" }),
            mirrorRow({ identity: twin, destinationId: "mirror-two" }),
          ],
        }),
    ],
    [
      "storedCoverageMissingForMappedSource",
      () =>
        syncInput({
          mappedSourceCalendars: [sourceCalendarA, sourceCalendarB],
          witness: witnessFor([sourceCalendarA, sourceCalendarB]),
          storedCoverage: [storedCoverage({ calendar: sourceCalendarA })],
        }),
    ],
    [
      "rowOnAnUnmappedSourceCalendar",
      () =>
        syncInput({
          mirrors: [mirrorRow({ identity, sourceCalendar: sourceCalendarB })],
        }),
    ],
    [
      "withheldCountsDisagreeWithWithheldList",
      () =>
        syncInput({
          completeness: {
            withheldCounts: { ...zeroedCounters(), emptyTimeRange: 2 },
            withheld: [],
          },
        }),
    ],
  ]);

describe("every refusal reason is a named, reachable cause", () => {
  test("SHADOW-I29: every refusal reason is reachable from a real input", () => {
    for (const reason of translationRefusals) {
      const build = inputsByRefusal.get(reason);
      if (!build) {
        throw new Error(`no input is defined for the refusal ${reason}`);
      }

      expect(`${reason}=>${refusalOf(build())}`).toBe(`${reason}=>${reason}`);
    }
  });

  test("SHADOW-I29: a refusal carries a detail naming what was wrong", () => {
    const translation = translateDestinationSync(
      syncInput({ mappedSourceCalendars: [], witness: witnessFor([]), storedCoverage: [] }),
      shadowOptions(),
    );
    if (translation.kind !== "refused") {
      throw new Error("expected a refusal");
    }

    expect(translation.detail.length).toBeGreaterThan(0);
  });

  test("SHADOW-I23: a mapping identity that cannot be skipped refuses the translation", () => {
    expect(
      refusalOf(
        syncInput({
          mirrors: [
            mirrorRow({ identity, destinationId: "mirror-one" }),
            mirrorRow({ identity: twin, destinationId: "mirror-two" }),
          ],
        }),
      ),
    ).toBe("duplicateSourceIdentityClaim");
  });
});
