import { describe, expect, it } from "vitest";
import { buildEventsUrl, resolveViewerTimeZone } from "../../src/lib/events-url";
import { runInTimeZone } from "../helpers/time-zone";

describe("buildEventsUrl", () => {
  runInTimeZone("America/Edmonton");

  it("asks for the range in the viewer's zone so all-day events are judged by local day", () => {
    const url = new URL(
      buildEventsUrl(new Date("2026-11-05T06:00:00.000Z"), new Date("2026-11-06T05:59:59.999Z")),
      "https://keeper.example",
    );
    expect(url.pathname).toBe("/api/events");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: "2026-11-05T06:00:00.000Z",
      to: "2026-11-06T05:59:59.999Z",
      timezone: "America/Edmonton",
    });
  });
});

describe.each(["America/Edmonton", "Asia/Tokyo", "Pacific/Auckland", "UTC"])("resolveViewerTimeZone in %s", (timeZone) => {
  runInTimeZone(timeZone);

  it("reports the browser zone as the viewer zone", () => {
    expect(resolveViewerTimeZone()).toBe(timeZone);
  });
});
