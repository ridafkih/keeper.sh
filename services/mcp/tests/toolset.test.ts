import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeeperMcpToolset } from "../src/toolset";
import type { KeeperToolContext } from "../src/toolset";

const context: KeeperToolContext = {
  apiBaseUrl: "https://api.test",
  bearerToken: "token-123",
};

interface CapturedRequest {
  url: string;
  method: string | null;
  body: string | null;
}

const readBody = (body: RequestInit["body"]): string | null => {
  if (typeof body === "string") {
    return body;
  }
  return null;
};

const stubFetch = (payload: unknown): CapturedRequest[] => {
  const requests: CapturedRequest[] = [];

  vi.stubGlobal("fetch", (url: string, options?: RequestInit) => {
    requests.push({
      body: readBody(options?.body),
      method: options?.method ?? null,
      url,
    });
    return Promise.resolve(Response.json(payload));
  });

  return requests;
};

const freeTimePayload = {
  durationMinutes: 30,
  from: "2026-03-02T00:00:00.000Z",
  slots: [
    {
      durationMinutes: 60,
      end: "2026-03-02T15:00:00.000Z",
      start: "2026-03-02T14:00:00.000Z",
    },
  ],
  timezone: "America/New_York",
  to: "2026-03-03T00:00:00.000Z",
};

describe("createKeeperMcpToolset", () => {
  it("exposes the full tool surface", () => {
    const toolset = createKeeperMcpToolset();

    expect(Object.keys(toolset).toSorted()).toEqual([
      "create_event",
      "delete_event",
      "find_free_time",
      "get_event",
      "get_event_count",
      "get_events",
      "get_ical_feed",
      "get_pending_invites",
      "list_accounts",
      "list_calendars",
      "pause_sync",
      "rsvp_event",
      "trigger_sync",
      "update_event",
    ]);
  });

  it("each tool has a title and description", () => {
    const toolset = createKeeperMcpToolset();

    for (const [, tool] of Object.entries(toolset)) {
      expect(tool.title).toBeTruthy();
      expect(tool.description).toBeTruthy();
    }
  });

  it("annotates every tool with hints clients can gate confirmation on", () => {
    const toolset = createKeeperMcpToolset();

    for (const [, tool] of Object.entries(toolset)) {
      expect(tool.annotations.openWorldHint).toBe(false);
      if (tool.annotations.readOnlyHint) {
        continue;
      }
      expect(typeof tool.annotations.destructiveHint).toBe("boolean");
    }
  });

  it("marks the tools that change existing calendar state as destructive", () => {
    const toolset = createKeeperMcpToolset();

    const destructive = Object.entries(toolset)
      .filter(([, tool]) => tool.annotations.destructiveHint === true)
      .map(([name]) => name)
      .toSorted();

    expect(destructive).toEqual([
      "delete_event",
      "pause_sync",
      "rsvp_event",
      "update_event",
    ]);
    expect(toolset.create_event.annotations.destructiveHint).toBe(false);
    expect(toolset.get_events.annotations.readOnlyHint).toBe(true);
  });

  it("accepts the opaque occurrence IDs returned by event reads", () => {
    const toolset = createKeeperMcpToolset();
    const occurrenceId = "occurrence:019c0000-0000-7000-8000-000000000001:1772445600000";
    const eventIdSchemas = [
      toolset.get_event.inputSchema?.eventId,
      toolset.update_event.inputSchema?.eventId,
      toolset.delete_event.inputSchema?.eventId,
      toolset.rsvp_event.inputSchema?.eventId,
    ];

    for (const schema of eventIdSchemas) {
      if (!schema) {
        throw new Error("Expected every event tool to expose an eventId schema");
      }
      expect(schema.safeParse(occurrenceId).success).toBe(true);
    }
  });
});

describe("find_free_time", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards the range, timezone and duration to the free-time route", async () => {
    const requests = stubFetch(freeTimePayload);

    await createKeeperMcpToolset().find_free_time.execute(context, {
      durationMinutes: 30,
      from: "2026-03-02T00:00:00Z",
      timezone: "America/New_York",
      to: "2026-03-03T00:00:00Z",
    });

    const url = new URL(requests[0]?.url ?? "");
    expect(url.pathname).toBe("/api/v1/events/free-time");
    expect(url.searchParams.get("from")).toBe("2026-03-02T00:00:00Z");
    expect(url.searchParams.get("to")).toBe("2026-03-03T00:00:00Z");
    expect(url.searchParams.get("timezone")).toBe("America/New_York");
    expect(url.searchParams.get("durationMinutes")).toBe("30");
  });

  it("forwards optional working-hour and filter parameters", async () => {
    const requests = stubFetch(freeTimePayload);

    await createKeeperMcpToolset().find_free_time.execute(context, {
      calendarId: "calendar-1,calendar-2",
      durationMinutes: 45,
      from: "2026-03-02T00:00:00Z",
      ignoreAllDayEvents: true,
      limit: 5,
      timezone: "America/New_York",
      to: "2026-03-03T00:00:00Z",
      workingDays: "1,2,3,4,5",
      workingHoursEnd: "17:00",
      workingHoursStart: "09:00",
    });

    const url = new URL(requests[0]?.url ?? "");
    expect(url.searchParams.get("workingHoursStart")).toBe("09:00");
    expect(url.searchParams.get("workingHoursEnd")).toBe("17:00");
    expect(url.searchParams.get("workingDays")).toBe("1,2,3,4,5");
    expect(url.searchParams.get("calendarId")).toBe("calendar-1,calendar-2");
    expect(url.searchParams.get("ignoreAllDayEvents")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("omits optional parameters that were not supplied", async () => {
    const requests = stubFetch(freeTimePayload);

    await createKeeperMcpToolset().find_free_time.execute(context, {
      durationMinutes: 30,
      from: "2026-03-02T00:00:00Z",
      timezone: "America/New_York",
      to: "2026-03-03T00:00:00Z",
    });

    const url = new URL(requests[0]?.url ?? "");
    expect(url.searchParams.has("workingHoursStart")).toBe(false);
    expect(url.searchParams.has("limit")).toBe(false);
  });

  it("localizes returned slots to the requested timezone", async () => {
    stubFetch(freeTimePayload);

    const result = await createKeeperMcpToolset().find_free_time.execute(context, {
      durationMinutes: 30,
      from: "2026-03-02T00:00:00Z",
      timezone: "America/New_York",
      to: "2026-03-03T00:00:00Z",
    });

    expect(result.slots).toEqual([
      {
        durationMinutes: 60,
        end: "2026-03-02T10:00:00-05:00",
        start: "2026-03-02T09:00:00-05:00",
      },
    ]);
  });

  it("requires a duration", async () => {
    stubFetch(freeTimePayload);

    await expect(createKeeperMcpToolset().find_free_time.execute(context, {
      from: "2026-03-02T00:00:00Z",
      timezone: "America/New_York",
      to: "2026-03-03T00:00:00Z",
    })).rejects.toThrow("'durationMinutes' is required");
  });

  it("requires the full range", async () => {
    stubFetch(freeTimePayload);

    await expect(createKeeperMcpToolset().find_free_time.execute(context, {
      durationMinutes: 30,
      from: "2026-03-02T00:00:00Z",
    })).rejects.toThrow("'from', 'to', and 'timezone' are required");
  });
});

describe("trigger_sync", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the sync route", async () => {
    const requests = stubFetch({ sourcesRefreshed: 3, triggered: true });

    const result = await createKeeperMcpToolset().trigger_sync.execute(context);

    expect(requests[0]?.url).toBe("https://api.test/api/v1/sync");
    expect(requests[0]?.method).toBe("POST");
    expect(result).toEqual({ sourcesRefreshed: 3, triggered: true });
  });

  it("surfaces the throttling error from the API", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(Response.json(
        { error: "A sync was already requested recently. Try again in 42 seconds." },
        { status: 429 },
      )));

    await expect(createKeeperMcpToolset().trigger_sync.execute(context)).rejects.toThrow(
      "Try again in 42 seconds",
    );
  });
});

describe("pause_sync", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("patches the calendar with the paused flag", async () => {
    const calendarId = "019c0000-0000-7000-8000-000000000001";
    const requests = stubFetch({ calendarId, paused: true });

    const result = await createKeeperMcpToolset().pause_sync.execute(context, {
      calendarId,
      paused: true,
    });

    expect(requests[0]?.url).toBe(`https://api.test/api/v1/calendars/${calendarId}`);
    expect(requests[0]?.method).toBe("PATCH");
    expect(requests[0]?.body).toBe(JSON.stringify({ paused: true }));
    expect(result).toEqual({ calendarId, paused: true });
  });

  it("resumes a calendar", async () => {
    const calendarId = "019c0000-0000-7000-8000-000000000001";
    const requests = stubFetch({ calendarId, paused: false });

    await createKeeperMcpToolset().pause_sync.execute(context, { calendarId, paused: false });

    expect(requests[0]?.body).toBe(JSON.stringify({ paused: false }));
  });

  it("requires a calendar ID", () => {
    stubFetch({});

    expect(
      () => createKeeperMcpToolset().pause_sync.execute(context, { paused: true }),
    ).toThrow("'calendarId' is required");
  });

  it("requires the paused flag", () => {
    stubFetch({});

    expect(
      () => createKeeperMcpToolset().pause_sync.execute(context, { calendarId: "calendar-1" }),
    ).toThrow("'paused' is required");
  });
});
