import { afterEach, describe, expect, it, vi } from "vitest";

import { rsvpOutlookEvent } from "../../../src/mutations/providers/outlook";

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

describe("rsvpOutlookEvent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("targets the selected provider instance when recurring instances share a UID", async () => {
    const sharedUid = "shared-series@example.com";
    const instances = [
      { iCalUId: sharedUid, id: "instance-1" },
      { iCalUId: sharedUid, id: "instance-2" },
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

      if (method === "GET") {
        return Response.json({ value: instances });
      }
      return new Response(null, { status: 202 });
    }));

    const result = await rsvpOutlookEvent(
      "access-token",
      { sourceEventId: "instance-2", sourceEventUid: sharedUid },
      "accepted",
    );

    expect(result).toEqual({ success: true });
    expect(requests).toEqual([
      {
        body: { sendResponse: true },
        method: "POST",
        url: "https://graph.microsoft.com/v1.0/me/events/instance-2/accept",
      },
    ]);
  });
});
