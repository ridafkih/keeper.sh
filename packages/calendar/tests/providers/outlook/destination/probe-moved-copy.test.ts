import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";

const HOUR_MS = 3_600_000;
const NOT_FOUND_STATUS = 404;
const OK_STATUS = 200;
const FORBIDDEN_STATUS = 403;

const UID = "040000008200E00074C5B7101A82E008@keeper.sh";
const STALE_GRAPH_ID = "AAMkAGI2-before-the-move";
const LIVE_GRAPH_ID = "AAMkAGI2-after-the-move";
const DESTINATION_EVENTS_PATH = "/v1.0/me/calendars/external-cal-1/events";
const SIBLING_EVENTS_PATH = "/v1.0/me/calendars/personal-cal/events";
const CALENDAR_LIST_PATH = "/v1.0/me/calendars";

const createProvider = () => createOutlookSyncProvider({
  accessToken: "test-token",
  accessTokenExpiresAt: new Date(Date.now() + HOUR_MS),
  calendarId: "cal-1",
  externalCalendarId: "external-cal-1",
  refreshToken: "test-refresh",
  userId: "user-1",
});

const probe = (): Promise<string> => {
  const provider = createProvider() as unknown as {
    probeRemoteEvent?: (
      reference: { deleteId: string; uid: string },
    ) => Promise<string>;
  };
  if (!provider.probeRemoteEvent) {
    throw new Error("The Outlook destination provider cannot confirm a copy is gone");
  }
  return provider.probeRemoteEvent({ deleteId: STALE_GRAPH_ID, uid: UID });
};

const calendarListBody = {
  value: [
    { id: "external-cal-1", isDefaultCalendar: false, name: "Keeper.sh" },
    { id: "personal-cal", isDefaultCalendar: false, name: "Personal" },
  ],
};

/*
 * A cross-folder move in Exchange reassigns the item id and keeps the iCalUId, so the
 * recorded id 404s while the copy sits in a sibling calendar the user can still see.
 */
const stubMailbox = (requests: string[]) => {
  vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
    const url = new URL(input.toString());
    requests.push(url.pathname);

    if (url.pathname.includes(encodeURIComponent(STALE_GRAPH_ID))) {
      return Promise.resolve(new Response("{}", { status: NOT_FOUND_STATUS }));
    }
    if (url.pathname === CALENDAR_LIST_PATH) {
      return Promise.resolve(Response.json(calendarListBody, { status: OK_STATUS }));
    }
    if (url.pathname === SIBLING_EVENTS_PATH) {
      return Promise.resolve(Response.json(
        { value: [{ iCalUId: UID, id: LIVE_GRAPH_ID }] },
        { status: OK_STATUS },
      ));
    }
    return Promise.resolve(Response.json({ value: [] }, { status: OK_STATUS }));
  }));
};

describe("Outlook destination: probing a copy moved into a sibling calendar", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports present when the copy now lives in a sibling calendar of the mailbox", async () => {
    stubMailbox([]);

    await expect(probe()).resolves.toBe("present");
  });

  it("asks the mailbox for its calendars before calling the copy gone", async () => {
    const requests: string[] = [];
    stubMailbox(requests);

    await probe();

    expect(requests).toContain(CALENDAR_LIST_PATH);
  });

  it("refuses rather than answering absent when the calendar list cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
      const url = new URL(input.toString());
      if (url.pathname.includes(encodeURIComponent(STALE_GRAPH_ID))) {
        return Promise.resolve(new Response("{}", { status: NOT_FOUND_STATUS }));
      }
      if (url.pathname === CALENDAR_LIST_PATH) {
        return Promise.resolve(new Response("{}", { status: FORBIDDEN_STATUS }));
      }
      return Promise.resolve(Response.json({ value: [] }, { status: OK_STATUS }));
    }));

    await expect(probe()).rejects.toThrow();
  });

  it("still reports absent once no calendar in the mailbox holds the copy", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
      const url = new URL(input.toString());
      if (url.pathname.includes(encodeURIComponent(STALE_GRAPH_ID))) {
        return Promise.resolve(new Response("{}", { status: NOT_FOUND_STATUS }));
      }
      if (url.pathname === CALENDAR_LIST_PATH) {
        return Promise.resolve(Response.json(calendarListBody, { status: OK_STATUS }));
      }
      return Promise.resolve(Response.json({ value: [] }, { status: OK_STATUS }));
    }));

    await expect(probe()).resolves.toBe("absent");
  });

  it("asks every sibling calendar even when the destination collection answers empty", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
      const url = new URL(input.toString());
      requests.push(url.pathname);
      if (url.pathname.includes(encodeURIComponent(STALE_GRAPH_ID))) {
        return Promise.resolve(new Response("{}", { status: NOT_FOUND_STATUS }));
      }
      if (url.pathname === CALENDAR_LIST_PATH) {
        return Promise.resolve(Response.json(calendarListBody, { status: OK_STATUS }));
      }
      return Promise.resolve(Response.json({ value: [] }, { status: OK_STATUS }));
    }));

    await probe();

    expect(requests).toContain(DESTINATION_EVENTS_PATH);
    expect(requests).toContain(SIBLING_EVENTS_PATH);
  });
});
