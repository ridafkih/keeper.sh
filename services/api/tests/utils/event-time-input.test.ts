import { describe, expect, it } from "vitest";
import {
  EventTimeInputError,
  parseEventTimeInput,
} from "../../src/utils/event-time-input";

interface ResolvedCase {
  expected: string;
  isAllDay: boolean;
  name: string;
  timeZone?: string;
  value: string;
}

interface RejectedCase {
  isAllDay: boolean;
  name: string;
  timeZone?: string;
  value: string;
}

const TIMED = false;
const ALL_DAY = true;

const RESOLVED_CASES: ResolvedCase[] = [
  {
    expected: "2026-11-05T15:00:00.000Z",
    isAllDay: TIMED,
    name: "a Z instant without a timezone",
    value: "2026-11-05T15:00:00Z",
  },
  {
    expected: "2026-11-05T15:00:00.000Z",
    isAllDay: TIMED,
    name: "a lowercase z instant",
    value: "2026-11-05T15:00:00z",
  },
  {
    expected: "2026-11-05T03:30:00.000Z",
    isAllDay: TIMED,
    name: "a +05:30 offset without a timezone",
    value: "2026-11-05T09:00:00+05:30",
  },
  {
    expected: "2026-11-05T16:00:00.000Z",
    isAllDay: TIMED,
    name: "an explicit offset that disagrees with the sent timezone",
    timeZone: "America/Edmonton",
    value: "2026-11-05T09:00:00-07:00",
  },
  {
    expected: "2026-11-05T15:00:00.000Z",
    isAllDay: TIMED,
    name: "a wall time in America/Edmonton",
    timeZone: "America/Edmonton",
    value: "2026-11-05T09:00:00",
  },
  {
    expected: "2026-11-05T15:00:00.000Z",
    isAllDay: TIMED,
    name: "a wall time without seconds",
    timeZone: "America/Edmonton",
    value: "2026-11-05T09:00",
  },
  {
    expected: "2026-11-05T15:00:00.250Z",
    isAllDay: TIMED,
    name: "a wall time with milliseconds",
    timeZone: "America/Edmonton",
    value: "2026-11-05T09:00:00.250",
  },
  {
    expected: "2026-11-05T03:30:00.000Z",
    isAllDay: TIMED,
    name: "a wall time in Asia/Kolkata",
    timeZone: "Asia/Kolkata",
    value: "2026-11-05T09:00:00",
  },
  {
    expected: "2026-11-05T03:30:00.000Z",
    isAllDay: TIMED,
    name: "a wall time in the Asia/Calcutta alias",
    timeZone: "Asia/Calcutta",
    value: "2026-11-05T09:00:00",
  },
  {
    expected: "2026-11-05T16:00:00.000Z",
    isAllDay: TIMED,
    name: "a wall time in a Windows zone name",
    timeZone: "Mountain Standard Time",
    value: "2026-11-05T09:00:00",
  },
  {
    expected: "2026-03-08T07:30:00.000Z",
    isAllDay: TIMED,
    name: "a wall time in the America/Toronto spring-forward gap",
    timeZone: "America/Toronto",
    value: "2026-03-08T02:30:00",
  },
  {
    expected: "2026-11-01T05:30:00.000Z",
    isAllDay: TIMED,
    name: "a wall time in the America/Toronto fall-back fold",
    timeZone: "America/Toronto",
    value: "2026-11-01T01:30:00",
  },
  {
    expected: "2026-11-05T00:00:00.000Z",
    isAllDay: ALL_DAY,
    name: "an all-day date",
    timeZone: "Asia/Tokyo",
    value: "2026-11-05",
  },
  {
    expected: "2026-11-05T00:00:00.000Z",
    isAllDay: ALL_DAY,
    name: "an all-day date without a timezone",
    value: "2026-11-05",
  },
  {
    expected: "2026-11-05T00:00:00.000Z",
    isAllDay: ALL_DAY,
    name: "an all-day local midnight in Asia/Tokyo",
    timeZone: "Asia/Tokyo",
    value: "2026-11-05T00:00:00",
  },
  {
    expected: "2026-11-05T00:00:00.000Z",
    isAllDay: ALL_DAY,
    name: "an all-day local midnight without a timezone",
    value: "2026-11-05T00:00:00",
  },
  {
    expected: "2026-11-05T00:00:00.000Z",
    isAllDay: ALL_DAY,
    name: "an all-day UTC midnight",
    value: "2026-11-05T00:00:00Z",
  },
  {
    expected: "2026-11-05T00:00:00.000Z",
    isAllDay: ALL_DAY,
    name: "an all-day midnight stated with a positive offset",
    value: "2026-11-05T00:00:00+09:00",
  },
];

const WALL_TIME_WITHOUT_ZONE: RejectedCase = {
  isAllDay: TIMED,
  name: "a wall time without a timezone",
  value: "2026-11-05T09:00:00",
};

const REJECTED_CASES: RejectedCase[] = [
  WALL_TIME_WITHOUT_ZONE,
  {
    isAllDay: TIMED,
    name: "a wall time in a timezone that does not resolve",
    timeZone: "Mars/Olympus",
    value: "2026-11-05T09:00:00",
  },
  {
    isAllDay: TIMED,
    name: "a Z instant sent with a timezone that does not resolve",
    timeZone: "Mars/Olympus",
    value: "2026-11-05T15:00:00Z",
  },
  {
    isAllDay: ALL_DAY,
    name: "an all-day date sent with a timezone that does not resolve",
    timeZone: "Mars/Olympus",
    value: "2026-11-05",
  },
  {
    isAllDay: TIMED,
    name: "a date on a timed event",
    timeZone: "America/Edmonton",
    value: "2026-11-05",
  },
  {
    isAllDay: TIMED,
    name: "prose",
    timeZone: "America/Edmonton",
    value: "Nov 5 2026",
  },
  {
    isAllDay: TIMED,
    name: "a space instead of T",
    timeZone: "America/Edmonton",
    value: "2026-11-05 09:00",
  },
  {
    isAllDay: TIMED,
    name: "a day that does not exist",
    timeZone: "America/Edmonton",
    value: "2026-02-30T09:00:00",
  },
  {
    isAllDay: TIMED,
    name: "an hour that does not exist",
    timeZone: "America/Edmonton",
    value: "2026-11-05T25:00:00",
  },
  {
    isAllDay: ALL_DAY,
    name: "an all-day date that does not exist",
    value: "2026-02-30",
  },
  {
    isAllDay: TIMED,
    name: "an empty string",
    timeZone: "America/Edmonton",
    value: "",
  },
];

describe("parseEventTimeInput", () => {
  for (const testCase of RESOLVED_CASES) {
    it(`resolves ${testCase.name}`, () => {
      const instant = parseEventTimeInput(testCase.value, testCase.timeZone, {
        isAllDay: testCase.isAllDay,
      });

      expect(instant.toISOString()).toBe(testCase.expected);
    });
  }

  for (const testCase of REJECTED_CASES) {
    it(`rejects ${testCase.name}`, () => {
      const parse = (): Date => parseEventTimeInput(testCase.value, testCase.timeZone, {
        isAllDay: testCase.isAllDay,
      });

      expect(parse).toThrow(EventTimeInputError);
    });
  }

  it("rejects with a RangeError that names the missing timezone", () => {
    let caught: unknown = null;
    try {
      parseEventTimeInput(WALL_TIME_WITHOUT_ZONE.value, WALL_TIME_WITHOUT_ZONE.timeZone, {
        isAllDay: WALL_TIME_WITHOUT_ZONE.isAllDay,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RangeError);
    expect(String((caught as Error).message).toLowerCase()).toContain("timezone");
  });
});
