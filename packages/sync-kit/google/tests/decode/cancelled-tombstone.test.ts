import { describe, expect, test } from "vitest";
import { decodeEvent } from "../../src/decode/decode-event";
import { cancelledException, timedItem } from "../support/items";
import { countingTimeDecoder } from "../support/time-decoder";

describe("a cancellation is a tombstone, not an unparseable event", () => {
  test("GOOG-O12: a three-field cancelled exception is a tombstone, not an unrepresentable event", () => {
    const decoder = countingTimeDecoder();
    const tombstone = cancelledException(
      "master_20260315T090000Z",
      "master",
      "2026-03-15T09:00:00.000Z",
    );

    const decoded = decodeEvent(tombstone, decoder.decode);

    expect(decoded.kind).toBe("cancelled");
    expect(decoder.calls()).toBe(0);
  });

  test("GOOG-O12: a confirmed event still reaches the time decoder", () => {
    const decoder = countingTimeDecoder();
    const item = timedItem({
      id: "confirmed",
      start: "2026-03-15T09:00:00.000Z",
      end: "2026-03-15T10:00:00.000Z",
    });

    decodeEvent(item, decoder.decode);

    expect(decoder.calls()).toBe(1);
  });

  test("GOOG-O12: a cancelled item keeps the identity Google gave it", () => {
    const decoder = countingTimeDecoder();
    const tombstone = cancelledException("instance-1", "master", "2026-03-15T09:00:00.000Z");

    const decoded = decodeEvent(tombstone, decoder.decode);

    expect(decoded.id?.value).toBe("instance-1");
  });
});
