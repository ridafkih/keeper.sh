import { afterEach, describe, expect, it, vi } from "vitest";

import { rsvpGoogleEvent } from "../../../src/mutations/providers/google";

const getRequestUrl = (input: string | URL | Request): string | URL => {
  if (input instanceof Request) {
    return input.url;
  }
  return input;
};

const parseRequestBody = (body: unknown): unknown => {
  if (typeof body === "string") {
    return JSON.parse(body);
  }
  return null;
};

describe("rsvpGoogleEvent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("targets the selected provider instance when recurring instances share a UID", async () => {
    const sharedUid = "shared-series@example.com";
    const instances = [
      {
        attendees: [{ email: "person@example.com", responseStatus: "needsAction", self: true }],
        iCalUID: sharedUid,
        id: "instance-1",
      },
      {
        attendees: [{ email: "person@example.com", responseStatus: "needsAction", self: true }],
        iCalUID: sharedUid,
        id: "instance-2",
      },
    ];
    const requests: { body: unknown; method: string; url: string }[] = [];

    vi.stubGlobal("fetch", vi.fn((
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = new URL(getRequestUrl(input));
      const method = init?.method ?? "GET";
      const body = parseRequestBody(init?.body);
      requests.push({ body, method, url: url.toString() });

      if (url.searchParams.has("iCalUID")) {
        return Response.json({ items: instances });
      }
      if (method === "GET") {
        return Response.json(instances[1]);
      }
      return Response.json(instances[1]);
    }));

    const result = await rsvpGoogleEvent(
      "access-token",
      "calendar-1",
      { sourceEventId: "instance-2", sourceEventUid: sharedUid },
      "accepted",
      "person@example.com",
    );

    expect(result).toEqual({ success: true });
    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      {
        method: "GET",
        url: "https://www.googleapis.com/calendar/v3/calendars/calendar-1/events/instance-2",
      },
      {
        method: "PATCH",
        url: "https://www.googleapis.com/calendar/v3/calendars/calendar-1/events/instance-2",
      },
    ]);
    expect(requests[1]?.body).toEqual({
      attendees: [{ email: "person@example.com", responseStatus: "accepted", self: true }],
    });
  });
});
