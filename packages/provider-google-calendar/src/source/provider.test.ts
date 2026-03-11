import { afterEach, describe, expect, it } from "bun:test";
import { GoogleCalendarSourceProvider } from "./provider";

const originalFetch = globalThis.fetch;

const createJsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, { status });

describe("GoogleCalendarSourceProvider", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("continues fetching events when calendar metadata cannot be fetched", async () => {
    const requestedUrls: string[] = [];

    const queuedFetch = (input: Request | URL | string) => {
      const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
      requestedUrls.push(url);

      return Promise.resolve(createJsonResponse({
        items: [
          {
            end: {
              dateTime: "2026-03-08T15:00:00.000Z",
              timeZone: "America/Toronto",
            },
            iCalUID: "external-uid-1",
            id: "event-1",
            start: {
              dateTime: "2026-03-08T14:00:00.000Z",
              timeZone: "America/Toronto",
            },
            status: "confirmed",
            summary: "Planning Session",
          },
        ],
        nextSyncToken: "next-sync-token",
      }));
    };
    queuedFetch.preconnect = originalFetch.preconnect;
    globalThis.fetch = queuedFetch;

    const provider = new GoogleCalendarSourceProvider(
      {
        accessToken: "access-token",
        accessTokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
        calendarAccountId: "account-1",
        calendarId: "calendar-1",
        database: {} as never,
        excludeFocusTime: false,
        excludeOutOfOffice: false,
        excludeWorkingLocation: false,
        externalCalendarId: "calendar@example.com",
        oauthCredentialId: "credential-1",
        originalName: "Original Calendar",
        refreshToken: "refresh-token",
        sourceName: "Calendar",
        syncToken: null,
        userId: "user-1",
      },
      {
        refreshAccessToken: () => Promise.reject(new Error("refreshAccessToken should not be called")),
      },
    );

    const result = await provider.fetchEvents(null);

    expect(result.fullSyncRequired).toBe(false);
    expect(result.events).toHaveLength(1);
    expect(result.nextSyncToken).toBe("next-sync-token");
    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("/events");
  });
});
