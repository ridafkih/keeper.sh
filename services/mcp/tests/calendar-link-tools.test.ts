import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeeperMcpToolset } from "../src/toolset";
import { testFeedbackOptions } from "./helpers/feedback-options";
import { DAILY_CAP_REACHED, MISSING_WRITE_SCOPE, context, stubApi } from "./helpers/api-stub";

const CALENDAR_ID = "019c0000-0000-7000-8000-000000000001";
const ACCOUNT_ID = "019c0000-0000-7000-8000-000000000003";
const FEED_URL = "https://example.com/team.ics";

const toolset = createKeeperMcpToolset({ feedback: testFeedbackOptions });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("add_calendar_link", () => {
  it("subscribes to the link and returns the new calendar", async () => {
    const created = { accountId: ACCOUNT_ID, id: CALENDAR_ID, name: "Team", url: FEED_URL, userId: "user-1" };
    const requests = stubApi(created, 201);

    const result = await toolset.add_calendar_link.execute(context, { name: "Team", url: FEED_URL });

    expect(requests).toEqual([{
      body: { name: "Team", url: FEED_URL },
      method: "POST",
      url: "https://api.test/api/v1/ics",
    }]);
    expect(result).toEqual({ accountId: ACCOUNT_ID, id: CALENDAR_ID, name: "Team", url: FEED_URL });
  });

  it("leaves the name to the feed when none is given", async () => {
    const requests = stubApi({ accountId: ACCOUNT_ID, id: CALENDAR_ID, name: "Team", url: FEED_URL }, 201);

    await toolset.add_calendar_link.execute(context, { url: FEED_URL });

    expect(requests[0]?.body).toEqual({ url: FEED_URL });
  });

  it("surfaces the Free plan account limit", async () => {
    stubApi({ error: "Account limit reached. Upgrade to Pro for unlimited accounts." }, 402);

    await expect(
      toolset.add_calendar_link.execute(context, { url: FEED_URL }),
    ).rejects.toThrow("Account limit reached");
  });

  it("surfaces a token without the write scope", async () => {
    stubApi(MISSING_WRITE_SCOPE, 403);

    await expect(
      toolset.add_calendar_link.execute(context, { url: FEED_URL }),
    ).rejects.toThrow("missing the keeper.write scope");
  });

  it("requires a URL", () => {
    stubApi({});

    expect(
      () => toolset.add_calendar_link.execute(context, {}),
    ).toThrow("'url' is required");
  });
});

describe("remove_calendar_link", () => {
  it("deletes the calendar link", async () => {
    const requests = stubApi({ success: true });

    const result = await toolset.remove_calendar_link.execute(context, { calendarId: CALENDAR_ID });

    expect(requests).toEqual([{
      body: null,
      method: "DELETE",
      url: `https://api.test/api/v1/ics/${CALENDAR_ID}`,
    }]);
    expect(result).toEqual({ removed: true });
  });

  it("surfaces a calendar that is not a link", async () => {
    stubApi({ error: "Calendar link not found" }, 404);

    await expect(
      toolset.remove_calendar_link.execute(context, { calendarId: CALENDAR_ID }),
    ).rejects.toThrow("Calendar link not found");
  });

  it("surfaces a token without the write scope", async () => {
    stubApi(MISSING_WRITE_SCOPE, 403);

    await expect(
      toolset.remove_calendar_link.execute(context, { calendarId: CALENDAR_ID }),
    ).rejects.toThrow("missing the keeper.write scope");
  });

  it("surfaces the daily request cap", async () => {
    stubApi(DAILY_CAP_REACHED, 429);

    await expect(
      toolset.remove_calendar_link.execute(context, { calendarId: CALENDAR_ID }),
    ).rejects.toThrow("Daily API limit exceeded");
  });
});
