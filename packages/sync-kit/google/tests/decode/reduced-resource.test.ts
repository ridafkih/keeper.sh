import { describe, expect, test } from "vitest";
import { decodeEvent } from "../../src/decode/decode-event";
import { decodeEventTime } from "../../src/decode/event-time";

const reduced = {
  id: "reduced-resource",
  iCalUID: "reduced-resource@google.com",
  etag: '"v4-reduced-resource"',
  status: "confirmed",
  updated: "2026-03-11T09:00:00.000Z",
};

describe("a resource that is not a whole event never becomes blank content", () => {
  test("GOOG-O21: an item carrying no occurrence at all is withheld, never decoded into empty fields", () => {
    const decoded = decodeEvent(reduced, decodeEventTime);

    expect(decoded.kind).toBe("undecodable");
    if (decoded.kind !== "undecodable") {
      throw new Error("a reduced resource decoded into content");
    }
    expect(decoded.reason).toBe("unparseable");
  });

  test("GOOG-O21: an item Google did send in full decodes, so the guard costs nothing real", () => {
    const decoded = decodeEvent(
      {
        ...reduced,
        summary: "A whole event",
        start: { dateTime: "2026-03-21T09:00:00.000Z", timeZone: "UTC" },
        end: { dateTime: "2026-03-21T10:00:00.000Z", timeZone: "UTC" },
      },
      decodeEventTime,
    );

    expect(decoded.kind).toBe("patch");
  });

  test("GOOG-O21: a title Google omits is an untitled event, and description and location stay absent", () => {
    const decoded = decodeEvent(
      {
        ...reduced,
        start: { dateTime: "2026-03-21T09:00:00.000Z", timeZone: "UTC" },
        end: { dateTime: "2026-03-21T10:00:00.000Z", timeZone: "UTC" },
      },
      decodeEventTime,
    );

    if (decoded.kind !== "patch") {
      throw new Error("a whole event with no summary was withheld");
    }
    expect(decoded.fields.title).toBe("");
    expect(decoded.fields.description).toBeNull();
    expect(decoded.fields.location).toBeNull();
  });
});
