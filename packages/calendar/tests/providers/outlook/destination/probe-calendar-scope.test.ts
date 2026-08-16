import { afterEach, describe, expect, it, vi } from "vitest";
import { createOutlookSyncProvider } from "../../../../src/providers/outlook/destination/provider";

const HOUR_MS = 3_600_000;
const NOT_FOUND_STATUS = 404;
const OK_STATUS = 200;

const UID = "040000008200E00074C5B7101A82E008@keeper.sh";
const STALE_GRAPH_ID = "AAMkAGI2-before-the-restore";
const LIVE_GRAPH_ID = "AAMkAGI2-after-the-restore";
const DESTINATION_EVENTS_PATH = "/v1.0/me/calendars/external-cal-1/events";
const DEFAULT_EVENTS_PATH = "/v1.0/me/events";

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

/*
 * Graph scopes /me/events to the mailbox's default calendar. A Keeper.sh destination is a
 * dedicated calendar, so a uid lookup sent to /me/events answers "no such event" for a copy
 * that is sitting in the destination calendar the whole time.
 */
const stubMailbox = (requests: string[]) => {
  vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
    const url = new URL(input.toString());
    requests.push(`${url.pathname}?${url.searchParams.toString()}`);

    if (url.pathname.includes(encodeURIComponent(STALE_GRAPH_ID))) {
      return Promise.resolve(new Response("{}", { status: NOT_FOUND_STATUS }));
    }
    if (url.pathname === DESTINATION_EVENTS_PATH) {
      return Promise.resolve(Response.json(
        { value: [{ iCalUId: UID, id: LIVE_GRAPH_ID }] },
        { status: OK_STATUS },
      ));
    }
    return Promise.resolve(Response.json({ value: [] }, { status: OK_STATUS }));
  }));
};

describe("Outlook destination: probing a copy on a non-default calendar", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports present when the destination calendar still holds the copy", async () => {
    stubMailbox([]);

    await expect(probe()).resolves.toBe("present");
  });

  it("asks the destination calendar, not only the mailbox default", async () => {
    const requests: string[] = [];
    stubMailbox(requests);

    await probe();

    expect(requests.some((request) => request.startsWith(DESTINATION_EVENTS_PATH))).toBe(true);
  });

  it("still reports absent once neither the destination calendar nor the mailbox holds it", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
      const url = new URL(input.toString());
      if (url.pathname.includes(encodeURIComponent(STALE_GRAPH_ID))) {
        return Promise.resolve(new Response("{}", { status: NOT_FOUND_STATUS }));
      }
      return Promise.resolve(Response.json({ value: [] }, { status: OK_STATUS }));
    }));

    await expect(probe()).resolves.toBe("absent");
  });

  it("reports present when the copy was moved out to another calendar in the mailbox", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL) => {
      const url = new URL(input.toString());
      if (url.pathname.includes(encodeURIComponent(STALE_GRAPH_ID))) {
        return Promise.resolve(new Response("{}", { status: NOT_FOUND_STATUS }));
      }
      if (url.pathname === DEFAULT_EVENTS_PATH) {
        return Promise.resolve(Response.json(
          { value: [{ iCalUId: UID, id: LIVE_GRAPH_ID }] },
          { status: OK_STATUS },
        ));
      }
      return Promise.resolve(Response.json({ value: [] }, { status: OK_STATUS }));
    }));

    await expect(probe()).resolves.toBe("present");
  });
});
