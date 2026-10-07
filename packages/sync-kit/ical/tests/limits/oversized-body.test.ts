import { describe, expect, test, vi } from "vitest";
import { parseIcsDocument, projectIcsFeed } from "../../src/index";
import { testScope } from "../support/feed";
import { testOptions } from "../support/options";

const bodyOfBytes = (bytes: number): string => `BEGIN:VCALENDAR\r\n${"x".repeat(bytes)}`;

describe("a body larger than the package will read", () => {
  test("ICAL-L2: a body one octet over maxBytes is refused", () => {
    const options = testOptions({ limits: { maxBytes: 4096 } });

    expect(parseIcsDocument(bodyOfBytes(4097), options)).toEqual({
      kind: "unreadable",
      reason: "limitExceeded",
    });
  });

  test("ICAL-L2: a body exactly at maxBytes is not refused for size", () => {
    const options = testOptions({ limits: { maxBytes: 4096 } });
    const document = parseIcsDocument(bodyOfBytes(4096 - "BEGIN:VCALENDAR\r\n".length), options);

    if (document.kind !== "unreadable") {
      expect(document.kind).toBe("readable");
      return;
    }
    expect(document.reason).not.toBe("limitExceeded");
  });

  test(
    "ICAL-L2: the size check happens before the unfolding pass, so content shape cannot change the refusal",
    () => {
      const options = testOptions({ limits: { maxBytes: 1024 } });
      const refusal = { kind: "unreadable", reason: "limitExceeded" };
      const flat = bodyOfBytes(20_000_000);
      const foldedEnormously = `BEGIN:VCALENDAR\r\nDESCRIPTION:start\r\n${" x\r\n".repeat(5_000_000)}`;

      expect(parseIcsDocument(flat, options)).toEqual(refusal);
      expect(parseIcsDocument(foldedEnormously, options)).toEqual(refusal);
    },
    5000,
  );

  test("ICAL-L2: the refusal reaches the caller as a failed Result, never as an empty snapshot", () => {
    const projection = projectIcsFeed({
      body: bodyOfBytes(20_000),
      scope: testScope,
      previousContentHash: null,
      options: testOptions({ limits: { maxBytes: 1024 } }),
    });

    expect(projection.ok).toBe(false);
  });

  test("ICAL-L2: the refusal is synchronous and arms no timer", () => {
    vi.useFakeTimers();
    try {
      parseIcsDocument(bodyOfBytes(20_000), testOptions({ limits: { maxBytes: 1024 } }));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  test("ICAL-L2: octets, not characters, decide the limit", () => {
    const options = testOptions({ limits: { maxBytes: 100 } });
    const multiByte = `BEGIN:VCALENDAR\r\nSUMMARY:${"é".repeat(60)}`;

    expect(parseIcsDocument(multiByte, options)).toEqual({
      kind: "unreadable",
      reason: "limitExceeded",
    });
  });
});
