import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeeperMcpToolset } from "../src/toolset";
import { testFeedbackOptions } from "./helpers/feedback-options";
import { DAILY_CAP_REACHED, MISSING_WRITE_SCOPE, context, stubApi } from "./helpers/api-stub";

const CALENDAR_ID = "019c0000-0000-7000-8000-000000000001";
const DESTINATION_ID = "019c0000-0000-7000-8000-000000000002";
const ACCOUNT_ID = "019c0000-0000-7000-8000-000000000003";

const toolset = createKeeperMcpToolset({ feedback: testFeedbackOptions });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("list_syncs", () => {
  it("returns each source and destination pair", async () => {
    const mappings = [{ destinationCalendarId: DESTINATION_ID, sourceCalendarId: CALENDAR_ID }];
    const requests = stubApi({ mappings });

    const result = await toolset.list_syncs.execute(context);

    expect(requests).toEqual([{ body: null, method: null, url: "https://api.test/api/v1/mappings" }]);
    expect(result).toEqual(mappings);
  });

  it("surfaces the daily request cap", async () => {
    stubApi(DAILY_CAP_REACHED, 429);

    await expect(toolset.list_syncs.execute(context)).rejects.toThrow("Daily API limit exceeded");
  });
});

describe("set_sync_destinations", () => {
  it("replaces the calendar's destinations", async () => {
    const requests = stubApi({ success: true });

    const result = await toolset.set_sync_destinations.execute(context, {
      calendarId: CALENDAR_ID,
      destinationCalendarIds: [DESTINATION_ID],
    });

    expect(requests).toEqual([{
      body: { calendarIds: [DESTINATION_ID] },
      method: "PUT",
      url: `https://api.test/api/v1/calendars/${CALENDAR_ID}/destinations`,
    }]);
    expect(result).toEqual({ calendarId: CALENDAR_ID, destinationCalendarIds: [DESTINATION_ID] });
  });

  it("surfaces the Free plan sync limit", async () => {
    stubApi({ error: "Mapping limit reached. Upgrade to Pro for unlimited sync mappings." }, 402);

    await expect(toolset.set_sync_destinations.execute(context, {
      calendarId: CALENDAR_ID,
      destinationCalendarIds: [DESTINATION_ID],
    })).rejects.toThrow("Mapping limit reached");
  });

  it("surfaces a token without the write scope", async () => {
    stubApi(MISSING_WRITE_SCOPE, 403);

    await expect(toolset.set_sync_destinations.execute(context, {
      calendarId: CALENDAR_ID,
      destinationCalendarIds: [],
    })).rejects.toThrow("missing the keeper.write scope");
  });

  it("requires the destination list", async () => {
    stubApi({});

    await expect(
      toolset.set_sync_destinations.execute(context, { calendarId: CALENDAR_ID }),
    ).rejects.toThrow("'destinationCalendarIds' must be an array of strings");
  });
});

describe("get_calendar_settings", () => {
  it("reads the calendar's settings", async () => {
    const settings = { destinationIds: [DESTINATION_ID], id: CALENDAR_ID, syncFutureRange: "2_years" };
    const requests = stubApi(settings);

    const result = await toolset.get_calendar_settings.execute(context, { calendarId: CALENDAR_ID });

    expect(requests[0]?.url).toBe(`https://api.test/api/v1/calendars/${CALENDAR_ID}/settings`);
    expect(requests[0]?.method).toBeNull();
    expect(result).toEqual(settings);
  });

  it("surfaces the daily request cap", async () => {
    stubApi(DAILY_CAP_REACHED, 429);

    await expect(
      toolset.get_calendar_settings.execute(context, { calendarId: CALENDAR_ID }),
    ).rejects.toThrow("Daily API limit exceeded");
  });
});

describe("update_calendar_settings", () => {
  it("patches only the settings provided", async () => {
    const requests = stubApi({ excludeEventName: true, id: CALENDAR_ID });

    await toolset.update_calendar_settings.execute(context, {
      calendarId: CALENDAR_ID,
      excludeAvailabilities: ["free"],
      excludeEventName: true,
      excludeTitleKeywords: ["Lunch"],
      syncFutureRange: "3_months",
    });

    expect(requests).toEqual([{
      body: {
        excludeAvailabilities: ["free"],
        excludeEventName: true,
        excludeTitleKeywords: ["Lunch"],
        syncFutureRange: "3_months",
      },
      method: "PATCH",
      url: `https://api.test/api/v1/calendars/${CALENDAR_ID}/settings`,
    }]);
  });

  it("surfaces the Pro requirement", async () => {
    stubApi({ error: "This setting requires a Pro plan." }, 403);

    await expect(toolset.update_calendar_settings.execute(context, {
      calendarId: CALENDAR_ID,
      markEventsAsPrivate: true,
    })).rejects.toThrow("This setting requires a Pro plan.");
  });

  it("surfaces a token without the write scope", async () => {
    stubApi(MISSING_WRITE_SCOPE, 403);

    await expect(toolset.update_calendar_settings.execute(context, {
      calendarId: CALENDAR_ID,
      excludeAllDayEvents: true,
    })).rejects.toThrow("missing the keeper.write scope");
  });

  it("rejects a call with no settings", () => {
    const requests = stubApi({});

    expect(
      () => toolset.update_calendar_settings.execute(context, { calendarId: CALENDAR_ID }),
    ).toThrow("Provide at least one setting to update");
    expect(requests).toEqual([]);
  });

  it("does not let the settings tool rename the calendar", () => {
    const requests = stubApi({});

    expect(
      () => toolset.update_calendar_settings.execute(context, { calendarId: CALENDAR_ID, name: "New" }),
    ).toThrow("Provide at least one setting to update");
    expect(requests).toEqual([]);
  });

  it("only accepts the sync ranges the API accepts", () => {
    const schema = toolset.update_calendar_settings.inputSchema?.syncHistoricRange;

    expect(schema?.safeParse("1_week").success).toBe(true);
    expect(schema?.safeParse("5_years").success).toBe(false);
  });
});

describe("rename_calendar", () => {
  it("patches the calendar name", async () => {
    const requests = stubApi({ id: CALENDAR_ID, name: "Work" });

    const result = await toolset.rename_calendar.execute(context, { calendarId: CALENDAR_ID, name: "Work" });

    expect(requests).toEqual([{
      body: { name: "Work" },
      method: "PATCH",
      url: `https://api.test/api/v1/calendars/${CALENDAR_ID}/settings`,
    }]);
    expect(result).toEqual({ id: CALENDAR_ID, name: "Work" });
  });

  it("surfaces a token without the write scope", async () => {
    stubApi(MISSING_WRITE_SCOPE, 403);

    await expect(
      toolset.rename_calendar.execute(context, { calendarId: CALENDAR_ID, name: "Work" }),
    ).rejects.toThrow("missing the keeper.write scope");
  });

  it("surfaces the daily request cap", async () => {
    stubApi(DAILY_CAP_REACHED, 429);

    await expect(
      toolset.rename_calendar.execute(context, { calendarId: CALENDAR_ID, name: "Work" }),
    ).rejects.toThrow("Daily API limit exceeded");
  });

  it("requires a name", () => {
    stubApi({});

    expect(
      () => toolset.rename_calendar.execute(context, { calendarId: CALENDAR_ID }),
    ).toThrow("'name' is required");
  });
});

describe("refresh_calendars", () => {
  it("refreshes one account", async () => {
    const requests = stubApi({ imported: 1, missing: 0, restored: 0 });

    const result = await toolset.refresh_calendars.execute(context, { accountId: ACCOUNT_ID });

    expect(requests).toEqual([{
      body: null,
      method: "POST",
      url: `https://api.test/api/v1/accounts/${ACCOUNT_ID}/refresh`,
    }]);
    expect(result).toEqual({ imported: 1, missing: 0, restored: 0 });
  });

  it("refreshes every account when no account is given", async () => {
    const requests = stubApi({ accountsRefreshed: 2 });

    await toolset.refresh_calendars.execute(context, {});

    expect(requests[0]?.url).toBe("https://api.test/api/v1/accounts/refresh-calendars");
    expect(requests[0]?.method).toBe("POST");
  });

  it("surfaces the refresh throttle", async () => {
    stubApi({ error: "A calendar refresh was already requested recently. Try again in 30 seconds." }, 429);

    await expect(toolset.refresh_calendars.execute(context)).rejects.toThrow("Try again in 30 seconds");
  });

  it("surfaces a token without the write scope", async () => {
    stubApi(MISSING_WRITE_SCOPE, 403);

    await expect(
      toolset.refresh_calendars.execute(context, { accountId: ACCOUNT_ID }),
    ).rejects.toThrow("missing the keeper.write scope");
  });
});
