import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeeperMcpToolset } from "../src/toolset";
import { DAILY_CAP_REACHED, MISSING_WRITE_SCOPE, context, stubApi } from "./helpers/api-stub";

const FEED_ID = "019c0000-0000-7000-8000-000000000010";
const CALENDAR_ID = "019c0000-0000-7000-8000-000000000001";

const feedSettings = {
  customEventName: "Busy",
  excludeAllDayEvents: false,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  includeEventDescription: false,
  includeEventLocation: false,
  includeEventName: false,
};

const storedFeed = {
  ...feedSettings,
  createdAt: "2026-11-01T00:00:00.000Z",
  id: FEED_ID,
  isDefault: true,
  legacyAlias: false,
  name: "My Calendar",
  token: "secret-token",
  userId: "user-1",
};

const toolset = createKeeperMcpToolset();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("list_ical_feeds", () => {
  it("returns each feed with its URL and calendars, without the raw token", async () => {
    const url = "https://www.keeper.sh/cal/secret-token.ics";
    const requests = stubApi([{ ...storedFeed, calendarCount: 1, calendarIds: [CALENDAR_ID], url }]);

    const result = await toolset.list_ical_feeds.execute(context);

    expect(requests[0]?.url).toBe("https://api.test/api/v1/ical/feeds");
    expect(result).toEqual([{
      ...feedSettings,
      calendarIds: [CALENDAR_ID],
      id: FEED_ID,
      isDefault: true,
      name: "My Calendar",
      url,
    }]);
  });

  it("surfaces the daily request cap", async () => {
    stubApi(DAILY_CAP_REACHED, 429);

    await expect(toolset.list_ical_feeds.execute(context)).rejects.toThrow("Daily API limit exceeded");
  });
});

describe("create_ical_feed", () => {
  it("creates a named feed", async () => {
    const requests = stubApi({ ...storedFeed, isDefault: false, name: "Work", url: "https://www.keeper.sh/cal/t.ics" }, 201);

    const result = await toolset.create_ical_feed.execute(context, { name: "Work" });

    expect(requests).toEqual([{ body: { name: "Work" }, method: "POST", url: "https://api.test/api/v1/ical/feeds" }]);
    expect(result.name).toBe("Work");
  });

  it("surfaces the Free plan feed limit", async () => {
    stubApi({ error: "Feed limit reached. Upgrade to Keeper.sh Pro for unlimited iCal feeds." }, 402);

    await expect(toolset.create_ical_feed.execute(context, { name: "Work" })).rejects.toThrow("Feed limit reached");
  });

  it("surfaces a token without the write scope", async () => {
    stubApi(MISSING_WRITE_SCOPE, 403);

    await expect(
      toolset.create_ical_feed.execute(context, { name: "Work" }),
    ).rejects.toThrow("missing the keeper.write scope");
  });
});

describe("update_ical_feed", () => {
  it("patches only the fields provided", async () => {
    const requests = stubApi({ ...storedFeed, includeEventName: true, name: "Shared" });

    await toolset.update_ical_feed.execute(context, { feedId: FEED_ID, includeEventName: true, name: "Shared" });

    expect(requests).toEqual([{
      body: { includeEventName: true, name: "Shared" },
      method: "PATCH",
      url: `https://api.test/api/v1/ical/feeds/${FEED_ID}`,
    }]);
  });

  it("surfaces the Pro requirement for feed settings", async () => {
    stubApi({ error: "iCal feed customization requires a Pro plan." }, 403);

    await expect(
      toolset.update_ical_feed.execute(context, { feedId: FEED_ID, includeEventLocation: true }),
    ).rejects.toThrow("iCal feed customization requires a Pro plan.");
  });

  it("surfaces a token without the write scope", async () => {
    stubApi(MISSING_WRITE_SCOPE, 403);

    await expect(
      toolset.update_ical_feed.execute(context, { feedId: FEED_ID, name: "Shared" }),
    ).rejects.toThrow("missing the keeper.write scope");
  });

  it("rejects a call with nothing to change", () => {
    const requests = stubApi({});

    expect(
      () => toolset.update_ical_feed.execute(context, { feedId: FEED_ID }),
    ).toThrow("Provide at least one field to update");
    expect(requests).toEqual([]);
  });
});

describe("set_ical_feed_calendars", () => {
  it("replaces the feed's calendars", async () => {
    const requests = stubApi({ calendarIds: [CALENDAR_ID] });

    const result = await toolset.set_ical_feed_calendars.execute(context, {
      calendarIds: [CALENDAR_ID],
      feedId: FEED_ID,
    });

    expect(requests).toEqual([{
      body: { calendarIds: [CALENDAR_ID] },
      method: "PUT",
      url: `https://api.test/api/v1/ical/feeds/${FEED_ID}/calendars`,
    }]);
    expect(result).toEqual({ calendarIds: [CALENDAR_ID], feedId: FEED_ID });
  });

  it("surfaces calendars the user does not own", async () => {
    stubApi({ error: "Some calendars not found" }, 404);

    await expect(toolset.set_ical_feed_calendars.execute(context, {
      calendarIds: [CALENDAR_ID],
      feedId: FEED_ID,
    })).rejects.toThrow("Some calendars not found");
  });

  it("surfaces a token without the write scope", async () => {
    stubApi(MISSING_WRITE_SCOPE, 403);

    await expect(toolset.set_ical_feed_calendars.execute(context, {
      calendarIds: [],
      feedId: FEED_ID,
    })).rejects.toThrow("missing the keeper.write scope");
  });
});

describe("delete_ical_feed", () => {
  it("deletes the feed", async () => {
    const requests = stubApi(null, 204);

    const result = await toolset.delete_ical_feed.execute(context, { feedId: FEED_ID });

    expect(requests).toEqual([{ body: null, method: "DELETE", url: `https://api.test/api/v1/ical/feeds/${FEED_ID}` }]);
    expect(result).toEqual({ deleted: true });
  });

  it("surfaces the refusal to delete the default feed", async () => {
    stubApi({ error: "The default feed cannot be deleted." }, 409);

    await expect(
      toolset.delete_ical_feed.execute(context, { feedId: FEED_ID }),
    ).rejects.toThrow("The default feed cannot be deleted.");
  });

  it("surfaces a token without the write scope", async () => {
    stubApi(MISSING_WRITE_SCOPE, 403);

    await expect(
      toolset.delete_ical_feed.execute(context, { feedId: FEED_ID }),
    ).rejects.toThrow("missing the keeper.write scope");
  });
});
