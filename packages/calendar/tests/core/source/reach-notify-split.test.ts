import { describe, expect, it } from "vitest";
import { refuseWhenOutOfReach } from "../../../src/core/source/writer";
import type { WriteBackReach } from "../../../src/core/source/writer";

const MY_MEETING = { audience: "others", authorship: "the_account" } as const;

const RETITLE = { summary: "Renamed on the destination" };
const MOVE = { endTime: new Date("2027-05-11T18:00:00.000Z"), startTime: new Date("2027-05-11T17:00:00.000Z") };
const REDESCRIBE = { description: "Bring the notes" };
const RELOCATE = { location: "Room 5" };
const ALL_DAY = { isAllDay: true };
const RETIME_ZONE = { startTimeZone: "Europe/Berlin" };

const refusalFor = (
  reach: WriteBackReach,
  write: { isDelete: boolean; updates?: Record<string, unknown> },
): string | undefined =>
  refuseWhenOutOfReach({ ...MY_MEETING, ...write }, reach)?.refused;

/*
 * The line the two meeting levels are drawn on is whether the people on the meeting hear
 * about the write. A retitled meeting shows its new title the next time they look; a moved
 * or cancelled one is mailed to every one of them, and no answer afterwards recalls it.
 *
 * The fields are enumerated rather than sampled because the split is only as good as its
 * least obvious member: an all-day flag and a timezone both move the meeting in somebody
 * else's calendar without either of them being called "startTime".
 */
describe("what the people on a meeting hear about", () => {
  const SILENT: [string, Record<string, unknown>][] = [
    ["a retitle", RETITLE],
    ["a new description", REDESCRIBE],
    ["a new location", RELOCATE],
  ];

  const NOTIFYING: [string, Record<string, unknown>][] = [
    ["a move", MOVE],
    ["a switch to all-day", ALL_DAY],
    ["a timezone change", RETIME_ZONE],
  ];

  for (const [name, updates] of SILENT) {
    it(`allows ${name} at my_meetings`, () => {
      expect(refusalFor("my_meetings", { isDelete: false, updates })).toBeUndefined();
    });
  }

  for (const [name, updates] of NOTIFYING) {
    it(`refuses ${name} at my_meetings`, () => {
      expect(refusalFor("my_meetings", { isDelete: false, updates }))
        .toBe("event_has_attendees");
    });

    it(`allows ${name} at my_meetings_notifying`, () => {
      expect(refusalFor("my_meetings_notifying", { isDelete: false, updates }))
        .toBeUndefined();
    });
  }

  it("counts a cancellation as notifying, whatever fields it carries", () => {
    expect(refusalFor("my_meetings", { isDelete: true })).toBe("event_has_attendees");
    expect(refusalFor("my_meetings_notifying", { isDelete: true })).toBeUndefined();
  });

  it("refuses every one of them at own_events", () => {
    for (const [, updates] of [...SILENT, ...NOTIFYING]) {
      expect(refusalFor("own_events", { isDelete: false, updates }))
        .toBe("event_has_attendees");
    }
  });
});
