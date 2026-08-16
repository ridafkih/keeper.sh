import { afterEach, describe, expect, it, vi } from "vitest";
import { createGoogleSyncProvider } from "../../../../src/providers/google/destination/provider";

const HOUR_MS = 3_600_000;
const OK_STATUS = 200;
const FORBIDDEN_STATUS = 403;

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

const calendarListBody = {
  items: [
    { accessRole: "owner", id: DESTINATION_CALENDAR, summary: "Destination" },
    { accessRole: "owner", id: SIBLING_CALENDAR, summary: "Personal" },
  ],
  kind: "calendar#calendarList",
};

const liveCopyBody = {
  items: [{ iCalUID: UID, id: "google-event-id", status: "confirmed" }],
};

describe("Google destination: a copy moved to another calendar of the same account", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports present when the copy now lives in a sibling calendar", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: URL | string) => {
      const url = input.toString();
      requested.push(url);
      if (url.includes("users/me/calendarList")) {
        return Promise.resolve(Response.json(calendarListBody, { status: OK_STATUS }));
      }
      if (url.includes(encodeURIComponent(SIBLING_CALENDAR))) {
        return Promise.resolve(Response.json(liveCopyBody, { status: OK_STATUS }));
      }
      return Promise.resolve(Response.json({ items: [] }, { status: OK_STATUS }));
    }));

    await expect(probe()).resolves.toBe("present");
    expect(requested.some((url) => url.includes(encodeURIComponent(SIBLING_CALENDAR))))
      .toBe(true);
  });

  it("refuses to call the copy gone when the account's calendars cannot be listed", async () => {
    vi.stubGlobal("fetch", vi.fn((input: URL | string) => {
      const url = input.toString();
      if (url.includes("users/me/calendarList")) {
        return Promise.resolve(new Response("{}", { status: FORBIDDEN_STATUS }));
      }
      return Promise.resolve(Response.json({ items: [] }, { status: OK_STATUS }));
    }));

    await expect(probe()).rejects.toThrow();
  });

  it("reports absent when no calendar of the account holds the copy", async () => {
    vi.stubGlobal("fetch", vi.fn((input: URL | string) => {
      const url = input.toString();
      if (url.includes("users/me/calendarList")) {
        return Promise.resolve(Response.json(calendarListBody, { status: OK_STATUS }));
      }
      return Promise.resolve(Response.json({ items: [] }, { status: OK_STATUS }));
    }));

    await expect(probe()).resolves.toBe("absent");
  });

  it("ignores a cancelled sighting in a sibling calendar", async () => {
    vi.stubGlobal("fetch", vi.fn((input: URL | string) => {
      const url = input.toString();
      if (url.includes("users/me/calendarList")) {
        return Promise.resolve(Response.json(calendarListBody, { status: OK_STATUS }));
      }
      if (url.includes(encodeURIComponent(SIBLING_CALENDAR))) {
        return Promise.resolve(Response.json(
          { items: [{ iCalUID: UID, id: "google-event-id", status: "cancelled" }] },
          { status: OK_STATUS },
        ));
      }
      return Promise.resolve(Response.json({ items: [] }, { status: OK_STATUS }));
    }));

    await expect(probe()).resolves.toBe("absent");
  });
});
