import { describe, expect, it } from "vitest";
import { createSyncEventContentHash } from "../../../src/core/events/content-hash";
import type { SyncableEventContent } from "../../../src/core/events/content-hash";

/*
 * Every live mapping stores this value as `event_mappings.syncEventHash`, and a
 * replace deletes before it adds, so redefining the hash empties mirrors fleet
 * wide. Pinned literally: recomputing it here would move with the definition.
 */
const GOLDEN_DESCRIPTION = [
  "R&D sync",
  "<a href=\"https://x.test/a?b=1&amp;c=2\">agenda</a>",
  "wrapped<br>line",
  "s: <https://tel.meet/x?pin=1&hs=2>",
].join("\n");

const GOLDEN_EVENT: SyncableEventContent = {
  availability: "busy",
  description: GOLDEN_DESCRIPTION,
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  exceptionDates: [new Date("2026-03-15T14:00:00.000Z")],
  isAllDay: false,
  location: "Room 1 &amp; 2",
  recurrenceId: new Date("2026-03-08T14:00:00.000Z"),
  recurrenceRule: { frequency: "WEEKLY", interval: 1 },
  startTime: new Date("2026-03-08T14:00:00.000Z"),
  startTimeZone: "America/Toronto",
  summary: "Golden fixture",
};

/** The same fields wrapped in the CRLF and surrounding whitespace `normalizeText` folds. */
const UNNORMALIZED_EVENT: SyncableEventContent = {
  ...GOLDEN_EVENT,
  description: `\r\n  ${GOLDEN_DESCRIPTION.replaceAll("\n", "\r\n")}  \r\n`,
  location: "  Room 1 &amp; 2\r\n",
  summary: "\r\n\tGolden fixture  ",
};

/** Absent text fields hash as the empty string, never as JSON null. */
const ABSENT_TEXT_EVENT: SyncableEventContent = {
  summary: "",
  endTime: new Date("2026-03-08T15:00:00.000Z"),
  startTime: new Date("2026-03-08T14:00:00.000Z"),
};

const GOLDEN_HASH = "aad8837686b33a9196b4a847333bfd5c6a1b4d61c36d6a73c8af975e84189522";
const ABSENT_TEXT_HASH = "7a4c1e46ffcdf7d790334965a580f2fb0b0f1e51326e622757a34bab69c05a9c";

describe("createSyncEventContentHash", () => {
  it("hashes the golden fixture to the value persisted on live mappings", () => {
    expect(createSyncEventContentHash(GOLDEN_EVENT)).toBe(GOLDEN_HASH);
  });

  it("hashes CRLF and surrounding whitespace to that same persisted value", () => {
    expect(createSyncEventContentHash(UNNORMALIZED_EVENT)).toBe(GOLDEN_HASH);
  });

  it("hashes absent text fields to the value persisted for an empty description", () => {
    expect(createSyncEventContentHash(ABSENT_TEXT_EVENT)).toBe(ABSENT_TEXT_HASH);
  });

  it("distinguishes the text fields from one another, so their order is fixed", () => {
    expect(createSyncEventContentHash({
      ...GOLDEN_EVENT,
      description: GOLDEN_EVENT.summary,
      location: GOLDEN_EVENT.description,
      summary: GOLDEN_EVENT.location ?? "",
    })).not.toBe(GOLDEN_HASH);
  });

  it("distinguishes the instants from one another, so their order is fixed", () => {
    expect(createSyncEventContentHash({
      ...GOLDEN_EVENT,
      endTime: GOLDEN_EVENT.startTime,
      startTime: GOLDEN_EVENT.endTime,
    })).not.toBe(GOLDEN_HASH);
  });
});
