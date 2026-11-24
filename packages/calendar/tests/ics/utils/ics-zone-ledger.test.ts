import { describe, expect, it } from "vitest";
import { createIcsZoneLedger } from "../../../src/ics/utils/ics-zone-ledger";

const HOUR_MS = 60 * 60 * 1000;

describe("createIcsZoneLedger", () => {
  it("writes canonical TZIDs and declares exactly the zones it wrote", () => {
    const ledger = createIcsZoneLedger();

    const start = ledger.writeDate(new Date("2026-11-24T16:00:00Z"), "US/Central", false);
    const end = ledger.writeDate(new Date("2026-11-24T17:00:00Z"), "Europe/Kiev", false);
    ledger.writeDate(new Date("2026-11-24T00:00:00Z"), "Asia/Tokyo", true);
    ledger.writeDate(new Date("2026-11-24T00:00:00Z"), "GMT-0600", false);

    expect(start.local?.timezone).toBe("America/Chicago");
    expect(end.local?.timezone).toBe("Europe/Kyiv");
    expect(ledger.buildTimezones().map(({ id }) => id)).toEqual(["America/Chicago", "Europe/Kyiv"]);
  });

  it("declares a zone written only by a DTEND after a fall-back DTSTART went out in UTC", () => {
    const ledger = createIcsZoneLedger();
    const ambiguousStart = new Date("2026-11-01T07:30:00Z");

    const start = ledger.writeDate(ambiguousStart, "America/Chicago", false);
    const end = ledger.writeDate(new Date(ambiguousStart.getTime() + HOUR_MS), "America/Chicago", false);

    expect(start.local).toBeUndefined();
    expect(end.local?.timezone).toBe("America/Chicago");
    expect(ledger.buildTimezones().map(({ id }) => id)).toEqual(["America/Chicago"]);
  });

  it("does not declare zones it only resolved", () => {
    const ledger = createIcsZoneLedger();

    expect(ledger.resolveWrittenTimeZone(new Date("2026-11-24T16:00:00Z"), "US/Central")).toBe("America/Chicago");
    expect(ledger.buildTimezones()).toEqual([]);
  });

  it("anchors each zone at the earliest instant written in it", () => {
    const ledger = createIcsZoneLedger();

    ledger.writeDate(new Date("2026-11-24T16:00:00Z"), "America/Chicago", false);
    ledger.writeDate(new Date("2019-03-01T16:00:00Z"), "America/Chicago", false);

    const [timezone] = ledger.buildTimezones();
    expect(timezone?.props[0]?.start.getUTCFullYear()).toBe(2018);
  });
});
