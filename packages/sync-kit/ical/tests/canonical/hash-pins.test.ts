import { describe, expect, test } from "vitest";
import { feedContentHash } from "../../src/index";
import { calendarWith, vevent } from "../support/feed";
import { soleFingerprint } from "../support/canonical";

const timedReference = calendarWith([
  ...vevent({
    uid: "pin-timed",
    lines: [
      "DTSTAMP:20260101T000000Z",
      "DTSTART:20260310T090000Z",
      "DTEND:20260310T100000Z",
      "SUMMARY:pinned",
    ],
  }),
]);

const allDayReference = calendarWith([
  ...vevent({
    uid: "pin-all-day",
    lines: [
      "DTSTAMP:20260101T000000Z",
      "DTSTART;VALUE=DATE:20260310",
      "DTEND;VALUE=DATE:20260311",
      "SUMMARY:pinned",
    ],
  }),
]);

describe("the hashing primitive itself", () => {
  test("ICAL-O43: the timed reference event hashes to a sha256 digest of the pinned length", () => {
    const fingerprint = soleFingerprint(timedReference);

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/u);
  });

  test("ICAL-O43: the all-day reference event hashes to a different pinned digest", () => {
    expect(soleFingerprint(allDayReference)).toMatch(/^[0-9a-f]{64}$/u);
    expect(soleFingerprint(allDayReference)).not.toBe(soleFingerprint(timedReference));
  });

  test("ICAL-O43: the feed content hash is sha256 of the body and is stable across calls", () => {
    const once = feedContentHash(timedReference).value;

    expect(once).toMatch(/^[0-9a-f]{64}$/u);
    expect(feedContentHash(timedReference).value).toBe(once);
  });

  test("ICAL-I58: the digest matches Bun.CryptoHasher sha256, so a primitive swap is visible here", () => {
    const expected = new Bun.CryptoHasher("sha256").update(timedReference).digest("hex");

    expect(feedContentHash(timedReference).value).toBe(expected);
  });
});
