import { afterEach, describe, expect, it, vi } from "vitest";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";

const HOUR_MS = 3_600_000;
const OK_STATUS = 200;

const UID = "abc123@keeper.sh";
const DESTINATION_CALENDAR = "destination-calendar";
const SIBLING_CALENDAR = "sibling-calendar";

const createProvider = () => createGoogleSyncProvider({
  accessToken: "test-token",
  accessTokenExpiresAt: new Date(Date.now() + HOUR_MS),
  calendarId: "cal-1",
  externalCalendarId: DESTINATION_CALENDAR,
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
    throw new Error("The Google destination provider cannot confirm a copy is gone");
  }
  return provider.probeRemoteEvent({ deleteId: "google-event-id", uid: UID });
};

/*
 * The sibling's entry carries an accessRole outside the four the entry schema lists, which
 * is what makes it unreadable — a new role, a field Google starts sending as null, any
 * shape the schema was not written for. The entry is dropped, and the calendar it named is
 * never asked about the copy.
 */
const calendarListWithUnreadableEntry = {
  items: [
    { accessRole: "owner", id: DESTINATION_CALENDAR, summary: "Destination" },
    { accessRole: "freeBusyWriter", id: SIBLING_CALENDAR, summary: "Personal" },
  ],
  kind: "calendar#calendarList",
};

const liveCopyBody = {
  items: [{ iCalUID: UID, id: "google-event-id", status: "confirmed" }],
};

const stubTransport = (requested: string[]): void => {
  vi.stubGlobal("fetch", vi.fn((input: URL | string) => {
    const url = input.toString();
    requested.push(url);
    if (url.includes("users/me/calendarList")) {
      return Promise.resolve(
        Response.json(calendarListWithUnreadableEntry, { status: OK_STATUS }),
      );
    }
    if (url.includes(encodeURIComponent(SIBLING_CALENDAR))) {
      return Promise.resolve(Response.json(liveCopyBody, { status: OK_STATUS }));
    }
    return Promise.resolve(Response.json({ items: [] }, { status: OK_STATUS }));
  }));
};

/*
 * This probe is the last gate before a real event on the user's own calendar is destroyed,
 * and its promise is that a calendar list it could not read is refused rather than assumed
 * empty. A whole request that fails is refused already; an entry the schema cannot parse
 * is the same ignorance arriving one calendar at a time, and answering "absent" from it
 * destroys the original of a copy the user can plainly see.
 */
describe("Google destination: a calendar whose list entry could not be read", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses to call the copy gone when a calendar entry could not be read", async () => {
    const requested: string[] = [];
    stubTransport(requested);

    await expect(probe()).rejects.toThrow();
  });

  it("does not answer absent while an unread calendar holds the live copy", async () => {
    const requested: string[] = [];
    stubTransport(requested);

    const presence = await probe().catch(() => "refused");

    expect(presence).not.toBe("absent");
  });
});
