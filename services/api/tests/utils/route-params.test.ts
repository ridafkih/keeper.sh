import { describe, expect, it } from "vitest";
import { withParamAsId } from "../../src/utils/route-params";
import type { AuthenticatedRouteCallback } from "../../src/utils/middleware";

const echoParams: AuthenticatedRouteCallback = ({ params }) => Response.json(params);

const request = new Request("https://api.test/api/v1/calendars/calendar-1/settings");

describe("withParamAsId", () => {
  it("hands the shared handler the named param as its only id param", async () => {
    const handler = withParamAsId("calendarId", echoParams);

    const response = await handler({ params: { calendarId: "calendar-1" }, request, userId: "user-1" });

    expect(await response.json()).toEqual({ id: "calendar-1" });
  });

  it("passes no params when the named param is missing", async () => {
    const handler = withParamAsId("calendarId", echoParams);

    const response = await handler({ params: {}, request, userId: "user-1" });

    expect(await response.json()).toEqual({});
  });
});
