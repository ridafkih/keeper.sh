import { describe, expect, it } from "vitest";
import type { IngestPlan } from "@keeper.sh/calendar";
import { groupWakesByDebounce } from "../../../src/utils/push-notifications/wake-debounce";

const FIVE_MINUTES_MS = 5 * 60 * 1000;

describe("groupWakesByDebounce", () => {
  it("reads pro calendars at once and folds free calendars for five minutes", () => {
    const groups = groupWakesByDebounce(
      [
        { calendarId: "calendar-pro", userId: "user-pro" },
        { calendarId: "calendar-free-a", userId: "user-free" },
        { calendarId: "calendar-free-b", userId: "user-free" },
      ],
      new Map<string, IngestPlan>([["user-free", "free"], ["user-pro", "pro"]]),
    );

    expect(groups).toEqual(new Map([
      [0, ["calendar-pro"]],
      [FIVE_MINUTES_MS, ["calendar-free-a", "calendar-free-b"]],
    ]));
  });

  it("reads a calendar at once when its owner's plan is unknown", () => {
    const groups = groupWakesByDebounce(
      [{ calendarId: "calendar-unknown", userId: "user-unknown" }],
      new Map(),
    );

    expect(groups).toEqual(new Map([[0, ["calendar-unknown"]]]));
  });

  it("returns no groups for no calendars", () => {
    expect(groupWakesByDebounce([], new Map())).toEqual(new Map());
  });
});
