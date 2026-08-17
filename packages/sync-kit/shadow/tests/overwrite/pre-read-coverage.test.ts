import { describe, expect, test } from "vitest";
import { runShadow } from "../support/scenario";
import {
  mirrorRow,
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

const changedDuringTheRead = () =>
  syncInput({
    mappedSourceCalendars: [sourceCalendarA],
    storedCoverage: [storedCoverage({ calendar: sourceCalendarA })],
    storedSourceEvents: [storedSourceEvent({ identity })],
    mirrors: [mirrorRow({ identity })],
    witness: {
      sourceCalendarsBeforeRemoteRead: [sourceCalendarA],
      sourceCalendarsAtLocalRead: [sourceCalendarA, sourceCalendarB],
      coverageNarrowedAfterRemoteRead: true,
    },
  });

describe("coverage must be the post-lock value", () => {
  test("SHADOW-O20: a changed source calendar set refuses rather than being quietly accepted", () => {
    const catalog = runShadow(changedDuringTheRead(), shadowOptions());

    expect(catalog.kind).toBe("notTranslated");
    if (catalog.kind !== "notTranslated") {
      throw new Error("expected a refusal");
    }
    expect(catalog.reason).toBe("sourceCalendarSetChangedDuringRead");
  });

  test("SHADOW-O20: the refusal carries no deletions field to be misread as zero", () => {
    const catalog = runShadow(changedDuringTheRead(), shadowOptions());

    expect(Reflect.get(catalog, "deletions")).toBeUndefined();
  });

  test("SHADOW-O20: an unchanged set under the same input translates normally", () => {
    const catalog = runShadow(
      syncInput({
        mappedSourceCalendars: [sourceCalendarA],
        storedCoverage: [storedCoverage({ calendar: sourceCalendarA })],
        storedSourceEvents: [storedSourceEvent({ identity })],
        mirrors: [mirrorRow({ identity })],
        witness: witnessFor([sourceCalendarA]),
      }),
      shadowOptions(),
    );

    expect(catalog.kind).toBe("cataloged");
  });
});
