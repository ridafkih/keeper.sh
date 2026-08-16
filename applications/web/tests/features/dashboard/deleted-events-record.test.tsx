import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import {
  DeletedEventsRecord,
  EMPTY_RECORD_COPY,
  TRUNCATED_RECORD_COPY,
} from "@/features/dashboard/components/deleted-events-record";
import type { WriteBackDeletion } from "@/features/dashboard/components/deleted-events-record";

const deletion: WriteBackDeletion = {
  confirmed: true,
  deletedAt: "2026-08-14T09:00:00.000Z",
  description: "Bring the slides",
  destinationCalendarName: "Work",
  endTime: "2026-08-01T10:30:00.000Z",
  expiresAt: "2026-09-13T09:00:00.000Z",
  id: "tombstone-1",
  isAllDay: false,
  location: "Room 2",
  sourceCalendarName: "Personal",
  startTime: "2026-08-01T10:00:00.000Z",
  startTimeZone: "Europe/London",
  title: "Standup",
};

const renderRecord = (deletions: WriteBackDeletion[], truncated = false): string => {
  const { document } = parseHTML(
    `<body>${renderToStaticMarkup(
      <DeletedEventsRecord deletions={deletions} truncated={truncated} />,
    )}</body>`,
  );
  return document.documentElement.textContent ?? "";
};

/*
 * This is the record the deletion consent promises. What it has to carry is enough for
 * somebody who deleted a copy by mistake to put the event back by hand: what it was called,
 * when it was, where, what it said, and which calendar it was destroyed on.
 */
describe("the record of originals Keeper.sh deleted", () => {
  it("shows what the event was, and where it was deleted from", () => {
    const text = renderRecord([deletion]);

    expect(text).toContain("Standup");
    expect(text).toContain("Room 2");
    expect(text).toContain("Bring the slides");
    expect(text).toContain("Personal");
    expect(text).toContain("Work");
  });

  it("says how long the record is kept", () => {
    expect(renderRecord([deletion])).toMatch(/kept until/i);
  });

  it("says so when the deletion was never confirmed", () => {
    const text = renderRecord([{ ...deletion, confirmed: false }]);

    expect(text).toMatch(/may still be there/i);
  });

  it("does not claim a deletion is unconfirmed when it is on record as applied", () => {
    expect(renderRecord([deletion])).not.toMatch(/may still be there/i);
  });

  it("says the record is empty rather than showing nothing at all", () => {
    expect(renderRecord([])).toContain(EMPTY_RECORD_COPY);
  });

  it("still names an event whose snapshot lost its details", () => {
    const text = renderRecord([{
      ...deletion,
      description: null,
      location: null,
      startTime: null,
      title: null,
    }]);

    expect(text).toContain("Untitled event");
    expect(text).toMatch(/could not read the details/i);
  });

  /*
   * A deletion that fell off the end of the list reads as a deletion that never happened,
   * which is the exact misreading this record exists to prevent. If the answer was cut, the
   * page says so.
   */
  it("says so when the record it was given had to stop short", () => {
    expect(renderRecord([deletion], true)).toContain(TRUNCATED_RECORD_COPY);
  });

  it("says nothing about older deletions when the whole record fit", () => {
    expect(renderRecord([deletion])).not.toContain(TRUNCATED_RECORD_COPY);
  });
});
