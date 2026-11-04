import { describe, expect, it } from "vitest";
import {
  resolveEventLocalEnd,
  resolveEventLocalStart,
  resolveEventStartDay,
  resolveViewerTimeZone,
} from "../../src/lib/event-day";
import { runInTimeZone } from "../helpers/time-zone";

const allDayNovemberFifth = {
  startTime: new Date("2026-11-05T00:00:00.000Z"),
  endTime: new Date("2026-11-06T00:00:00.000Z"),
  isAllDay: true,
};

const timedEdmontonEvening = {
  startTime: new Date("2026-11-05T01:30:00.000Z"),
  endTime: new Date("2026-11-05T02:30:00.000Z"),
  isAllDay: false,
};

const localDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

describe.each(["America/Edmonton", "Asia/Tokyo", "Pacific/Auckland", "UTC"])("in %s", (timeZone) => {
  runInTimeZone(timeZone);

  it("reports the browser zone as the viewer zone", () => {
    expect(resolveViewerTimeZone()).toBe(timeZone);
  });

  it("puts an all-day event on its calendar date", () => {
    const day = resolveEventStartDay(allDayNovemberFifth);
    expect(localDate(day)).toBe("2026-11-05");
    expect(day.getHours()).toBe(0);
  });

  it("starts and ends an all-day event at local midnight of its dates", () => {
    expect(resolveEventLocalStart(allDayNovemberFifth).getTime()).toBe(new Date(2026, 10, 5).getTime());
    expect(resolveEventLocalEnd(allDayNovemberFifth).getTime()).toBe(new Date(2026, 10, 6).getTime());
  });

  it("keeps a timed event at its instant", () => {
    expect(resolveEventLocalStart(timedEdmontonEvening)).toBe(timedEdmontonEvening.startTime);
    expect(resolveEventLocalEnd(timedEdmontonEvening)).toBe(timedEdmontonEvening.endTime);
  });
});

describe("timed events west of UTC", () => {
  runInTimeZone("America/Edmonton");

  it("fall on the local day of their start", () => {
    expect(localDate(resolveEventStartDay(timedEdmontonEvening))).toBe("2026-11-04");
  });
});
