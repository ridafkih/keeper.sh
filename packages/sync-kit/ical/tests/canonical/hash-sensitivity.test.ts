import { describe, expect, test } from "vitest";
import { calendarWith, vevent } from "../support/feed";
import { soleFingerprint } from "../support/canonical";

const berlinVtimezone = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Berlin",
  "BEGIN:STANDARD",
  "DTSTART:19701025T030000",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700329T020000",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
] as const;

const eventWith = (lines: readonly string[]): string =>
  calendarWith([
    ...berlinVtimezone,
    ...vevent({
      uid: "evt-sensitive",
      lines: [
        "DTSTAMP:20260101T000000Z",
        "DTSTART;TZID=Europe/Berlin:20260302T090000",
        "DTEND;TZID=Europe/Berlin:20260302T100000",
        "RRULE:FREQ=WEEKLY;COUNT=8",
        "EXDATE;TZID=Europe/Berlin:20260309T090000",
        "SUMMARY:sensitive",
        "DESCRIPTION:body",
        "LOCATION:room 1",
        "TRANSP:OPAQUE",
        "CLASS:PUBLIC",
        ...lines,
      ],
    }),
  ]);

const mutations = [
  { name: "the title", body: eventWith(["SUMMARY:renamed"]) },
  { name: "the description", body: eventWith(["DESCRIPTION:different body"]) },
  { name: "the location", body: eventWith(["LOCATION:room 2"]) },
  { name: "availability", body: eventWith(["TRANSP:TRANSPARENT"]) },
  { name: "visibility", body: eventWith(["CLASS:PRIVATE"]) },
  { name: "the start time", body: eventWith(["DTSTART;TZID=Europe/Berlin:20260302T100000"]) },
  { name: "the recurrence rule", body: eventWith(["RRULE:FREQ=DAILY;COUNT=8"]) },
  { name: "an exception date", body: eventWith(["EXDATE;TZID=Europe/Berlin:20260316T090000"]) },
  {
    name: "the timezone the event is anchored in",
    body: eventWith(["DTSTART;TZID=Europe/London:20260302T090000"]),
  },
] as const;

describe("what the fingerprint must see", () => {
  for (const mutation of mutations) {
    test(`ICAL-O19: changing ${mutation.name} moves the fingerprint`, () => {
      const baseline = soleFingerprint(eventWith([]));
      expect(baseline).not.toBe("none");
      expect(soleFingerprint(mutation.body)).not.toBe(baseline);
    });
  }

  test("ICAL-O19: two events differing only in UID hash differently, so identity is in the hash", () => {
    const first = calendarWith([
      ...vevent({
        uid: "evt-one",
        lines: ["DTSTAMP:20260101T000000Z", "DTSTART:20260310T090000Z", "DTEND:20260310T100000Z"],
      }),
    ]);
    const second = first.replace("UID:evt-one", "UID:evt-two");

    expect(soleFingerprint(second)).not.toBe(soleFingerprint(first));
  });
});
