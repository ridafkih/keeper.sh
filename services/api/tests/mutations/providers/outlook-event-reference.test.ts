import { afterEach, describe, expect, it, vi } from "vitest";

import { deleteOutlookEvent, updateOutlookEvent } from "../../../src/mutations/providers/outlook";

const getRequestUrl = (input: string | URL | Request): string => {
  if (input instanceof Request) {
    return input.url;
  }
  return input.toString();
};

const stubGraph = () => {
  const requests: { method: string; url: string }[] = [];

  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = decodeURIComponent(getRequestUrl(input));
    requests.push({ method, url });

    if (method === "GET" && url.includes("$filter")) {
      return Response.json({ value: [{ iCalUId: "uid@example.com", id: "found-by-uid" }] });
    }
    if (method === "GET") {
      return Response.json({ iCalUId: "uid@example.com", id: "graph-event-id", isAllDay: false });
    }
    if (method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    return Response.json({ id: "event" });
  }));

  return requests;
};

describe("outlook event references", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates an ingested event by its Graph ID without searching by iCal UID", async () => {
    const requests = stubGraph();

    const result = await updateOutlookEvent(
      "access-token",
      { sourceEventId: "graph-event-id", sourceEventUid: "uid@example.com" },
      { title: "Renamed" },
    );

    expect(result.success).toBe(true);
    expect(requests).toEqual([
      { method: "GET", url: "https://graph.microsoft.com/v1.0/me/events/graph-event-id" },
      { method: "PATCH", url: "https://graph.microsoft.com/v1.0/me/events/graph-event-id" },
    ]);
  });

  it("deletes an ingested event by its Graph ID without searching the mailbox", async () => {
    const requests = stubGraph();

    const result = await deleteOutlookEvent(
      "access-token",
      { sourceEventId: "graph-event-id", sourceEventUid: "uid@example.com" },
    );

    expect(result.success).toBe(true);
    expect(requests).toEqual([
      { method: "DELETE", url: "https://graph.microsoft.com/v1.0/me/events/graph-event-id" },
    ]);
  });

  it("falls back to the iCal UID for events without a Graph ID", async () => {
    const requests = stubGraph();

    const result = await updateOutlookEvent(
      "access-token",
      { sourceEventId: null, sourceEventUid: "uid@example.com" },
      { title: "Renamed" },
    );

    expect(result.success).toBe(true);
    expect(requests.map(({ method }) => method)).toEqual(["GET", "PATCH"]);
    expect(requests[1]?.url).toBe("https://graph.microsoft.com/v1.0/me/events/found-by-uid");
  });
});
