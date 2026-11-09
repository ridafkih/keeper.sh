import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPendingOutlookInvites } from "../../../src/mutations/providers/outlook";

const UTC_PREFERENCE = /outlook\.timezone\s*=\s*"UTC"/i;

const GRAPH_CALENDAR_VIEW = {
  value: [
    {
      end: { dateTime: "2026-11-05T16:00:00.0000000", timeZone: "UTC" },
      iCalUId: "timed-invite",
      id: "graph-timed",
      isAllDay: false,
      organizer: { emailAddress: { address: "organizer@example.com", name: "Organizer" } },
      responseStatus: { response: "notResponded" },
      start: { dateTime: "2026-11-05T15:00:00.0000000", timeZone: "UTC" },
      subject: "Timed invite",
    },
    {
      end: { dateTime: "2026-11-08T00:00:00.0000000", timeZone: "UTC" },
      iCalUId: "all-day-invite",
      id: "graph-all-day",
      isAllDay: true,
      responseStatus: { response: "notResponded" },
      start: { dateTime: "2026-11-07T00:00:00.0000000", timeZone: "UTC" },
      subject: "All-day invite",
    },
    {
      end: { dateTime: "2026-11-06T10:00:00.0000000" },
      iCalUId: "zoneless-invite",
      id: "graph-zoneless",
      isAllDay: false,
      responseStatus: { response: "notResponded" },
      start: { dateTime: "2026-11-06T09:00:00.0000000" },
      subject: "Invite without a timezone",
    },
  ],
};

const graphFetch = vi.fn((_input: string | URL | Request, _init?: RequestInit): Promise<Response> =>
  Promise.resolve(Response.json(GRAPH_CALENDAR_VIEW)));

const readSentPreference = (): string => {
  const [, init] = graphFetch.mock.calls[0] ?? [];
  return new Headers(init?.headers).get("prefer") ?? "";
};

describe("getPendingOutlookInvites", () => {
  beforeEach(() => {
    graphFetch.mockClear();
    vi.stubGlobal("fetch", graphFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks Graph for start and end times in UTC", async () => {
    await getPendingOutlookInvites("token", "2026-11-01T00:00:00Z", "2026-11-30T00:00:00Z");

    expect(readSentPreference()).toMatch(UTC_PREFERENCE);
  });

  it("returns a timed invite as the Graph UTC instant with a Z suffix", async () => {
    const invites = await getPendingOutlookInvites("token", "2026-11-01T00:00:00Z", "2026-11-30T00:00:00Z");
    const timed = invites.find((invite) => invite.sourceEventUid === "timed-invite");

    expect({ end: timed?.endTime, start: timed?.startTime }).toEqual({
      end: "2026-11-05T16:00:00.000Z",
      start: "2026-11-05T15:00:00.000Z",
    });
  });

  it("returns an all-day invite as its calendar date at UTC midnight", async () => {
    const invites = await getPendingOutlookInvites("token", "2026-11-01T00:00:00Z", "2026-11-30T00:00:00Z");
    const allDay = invites.find((invite) => invite.sourceEventUid === "all-day-invite");

    expect({ end: allDay?.endTime, isAllDay: allDay?.isAllDay, start: allDay?.startTime }).toEqual({
      end: "2026-11-08T00:00:00.000Z",
      isAllDay: true,
      start: "2026-11-07T00:00:00.000Z",
    });
  });

  it("skips a timed invite whose times carry no timezone", async () => {
    const invites = await getPendingOutlookInvites("token", "2026-11-01T00:00:00Z", "2026-11-30T00:00:00Z");

    expect(invites.map((invite) => invite.sourceEventUid)).toEqual(["timed-invite", "all-day-invite"]);
  });

  it("returns only instants that end in Z", async () => {
    const invites = await getPendingOutlookInvites("token", "2026-11-01T00:00:00Z", "2026-11-30T00:00:00Z");
    const times = invites.flatMap((invite) => [invite.startTime, invite.endTime]);

    expect(times.length).toBeGreaterThan(0);
    expect(times.filter((time) => !time.endsWith("Z"))).toEqual([]);
  });
});
