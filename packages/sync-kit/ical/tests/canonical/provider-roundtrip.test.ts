import { describe, expect, test } from "vitest";
import { calendarWith, vevent } from "../support/feed";
import { soleFingerprint } from "../support/canonical";

const referenceEvent = calendarWith([
  ...vevent({
    uid: "evt-reference",
    lines: [
      "SEQUENCE:0",
      "CREATED:20260101T000000Z",
      "LAST-MODIFIED:20260101T000000Z",
      "DTSTAMP:20260101T000000Z",
      "DTSTART:20260310T090000Z",
      "DTEND:20260310T100000Z",
      "SUMMARY:reference event",
      "DESCRIPTION:a description",
      "LOCATION:room 1",
      "TRANSP:OPAQUE",
      "CLASS:PUBLIC",
    ],
  }),
]);

const rewriteLine = (body: string, prefix: string, replacement: string): string =>
  body
    .split("\r\n")
    .map((line) => {
      if (!line.startsWith(prefix)) {
        return line;
      }
      return replacement;
    })
    .join("\r\n");

const providerRewrites = [
  {
    name: "Google rewrites DTSTAMP on every read",
    apply: (body: string) => rewriteLine(body, "DTSTAMP:", "DTSTAMP:20260815T121314Z"),
  },
  {
    name: "Microsoft Graph bumps SEQUENCE when it stores the event",
    apply: (body: string) => rewriteLine(body, "SEQUENCE:", "SEQUENCE:7"),
  },
  {
    name: "every provider replaces PRODID with its own",
    apply: (body: string) =>
      rewriteLine(body, "PRODID:", "PRODID:-//Google Inc//Google Calendar 70.9054//EN"),
  },
  {
    name: "a provider stamps its own CREATED",
    apply: (body: string) => rewriteLine(body, "CREATED:", "CREATED:20260815T121314Z"),
  },
  {
    name: "a provider stamps its own LAST-MODIFIED",
    apply: (body: string) => rewriteLine(body, "LAST-MODIFIED:", "LAST-MODIFIED:20260815T121314Z"),
  },
  {
    name: "a provider re-emits the properties in a different order",
    apply: (body: string) => {
      const lines = body.split("\r\n");
      const start = lines.indexOf("BEGIN:VEVENT");
      const end = lines.indexOf("END:VEVENT");
      const inner = lines.slice(start + 1, end);
      return [
        ...lines.slice(0, start + 1),
        ...[...inner].toReversed(),
        ...lines.slice(end),
      ].join("\r\n");
    },
  },
  {
    name: "a provider folds at a different width",
    apply: (body: string) =>
      body.replace("DESCRIPTION:a description", "DESCRIPTION:a des\r\n cription"),
  },
  {
    name: "a provider writes LF instead of CRLF",
    apply: (body: string) => body.replaceAll("\r\n", "\n"),
  },
] as const;

describe("reading back what we wrote", () => {
  for (const rewrite of providerRewrites) {
    test(`ICAL-O14: ${rewrite.name} does not change the fingerprint`, () => {
      const baseline = soleFingerprint(referenceEvent);
      expect(baseline).not.toBe("none");
      expect(soleFingerprint(rewrite.apply(referenceEvent))).toBe(baseline);
    });
  }

  test("ICAL-O15: an all-day event a provider re-emits on the UTC day grid hashes identically", () => {
    const writtenFromTokyo = calendarWith([
      ...vevent({
        uid: "evt-all-day",
        lines: [
          "DTSTAMP:20260101T000000Z",
          "DTSTART;VALUE=DATE:20260310",
          "DTEND;VALUE=DATE:20260311",
          "SUMMARY:all day",
        ],
      }),
    ]);
    const readBackOnUtcGrid = writtenFromTokyo.replace(
      "DTSTART;VALUE=DATE:20260310\r\nDTEND;VALUE=DATE:20260311",
      "DTSTART;VALUE=DATE:20260310\r\nDTEND;VALUE=DATE:20260311\r\nX-MICROSOFT-CDO-ALLDAYEVENT:TRUE",
    );

    expect(soleFingerprint(readBackOnUtcGrid)).toBe(soleFingerprint(writtenFromTokyo));
    expect(soleFingerprint(writtenFromTokyo)).not.toBe("none");
  });

  test("ICAL-O15: an all-day event authored in a zone ahead of UTC hashes as a pair of UTC midnights", () => {
    const authoredInTokyo = calendarWith([
      ...vevent({
        uid: "evt-all-day",
        lines: [
          "DTSTAMP:20260101T000000Z",
          "DTSTART;TZID=Asia/Tokyo:20260310T000000",
          "DTEND;TZID=Asia/Tokyo:20260311T000000",
          "SUMMARY:all day",
        ],
      }),
    ]);
    const utcDateGrid = calendarWith([
      ...vevent({
        uid: "evt-all-day",
        lines: [
          "DTSTAMP:20260101T000000Z",
          "DTSTART;VALUE=DATE:20260310",
          "DTEND;VALUE=DATE:20260311",
          "SUMMARY:all day",
        ],
      }),
    ]);

    expect(soleFingerprint(authoredInTokyo)).toBe(soleFingerprint(utcDateGrid));
  });

  test("ICAL-O16: a destination widening a degenerate range does not change the source fingerprint", () => {
    const degenerate = calendarWith([
      ...vevent({
        uid: "evt-degenerate",
        lines: [
          "DTSTAMP:20260101T000000Z",
          "DTSTART:20260310T090000Z",
          "DTEND:20260310T090000Z",
          "SUMMARY:zero length",
        ],
      }),
    ]);
    const before = soleFingerprint(degenerate);
    const widenedByDestination = degenerate.replace("DTEND:20260310T090000Z", "DTEND:20260310T090100Z");

    expect(before).not.toBe("none");
    expect(soleFingerprint(degenerate)).toBe(before);
    expect(soleFingerprint(widenedByDestination)).not.toBe(before);
  });

  test("ICAL-O17: sub-second precision a provider truncated does not change the fingerprint", () => {
    const withMilliseconds = calendarWith([
      ...vevent({
        uid: "evt-millis",
        lines: [
          "DTSTAMP:20260101T000000Z",
          "DTSTART:20260310T090000Z",
          "DTEND:20260310T100000Z",
          "SUMMARY:truncated",
          "X-KEEPER-SUBSECOND:250",
        ],
      }),
    ]);
    const truncated = withMilliseconds.replace("X-KEEPER-SUBSECOND:250\r\n", "");

    expect(soleFingerprint(truncated)).toBe(soleFingerprint(withMilliseconds));
  });
});
