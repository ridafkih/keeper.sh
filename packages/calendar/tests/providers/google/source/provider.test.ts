import { afterEach, describe, expect, it } from "bun:test";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { ProcessEventsOptions } from "../../../../src/core/oauth/source-provider";
import type { SourceEvent, SourceSyncResult } from "../../../../src/core/types";
import { GoogleCalendarSourceProvider } from "../../../../src/providers/google/source/provider";

const originalFetch = globalThis.fetch;

const createJsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, { status });

const getUrlAsString = (input: Request | URL | string) => {
  if (input instanceof Request) {
    return input.url;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input;
};

class TestableGoogleCalendarSourceProvider extends GoogleCalendarSourceProvider {
  runProcessEvents(events: SourceEvent[], options: ProcessEventsOptions): Promise<SourceSyncResult> {
    return this.processEvents(events, options);
  }
}

describe("GoogleCalendarSourceProvider", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("removes out-of-range events directly without triggering full resync", async () => {
    let outOfRangeDeleteCalled = false;
    const mockDatabase = {
      delete: () => {
        outOfRangeDeleteCalled = true;
        return {
          where: () => Promise.resolve(),
        };
      },
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
    };

    const provider = new TestableGoogleCalendarSourceProvider(
      {
        accessToken: "access-token",
        accessTokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
        calendarAccountId: "account-1",
        calendarId: "calendar-1",
        database: mockDatabase as unknown as BunSQLDatabase,
        excludeFocusTime: false,
        excludeOutOfOffice: false,
        externalCalendarId: "calendar@example.com",
        oauthCredentialId: "credential-1",
        originalName: "Original Calendar",
        refreshToken: "refresh-token",
        sourceName: "Calendar",
        syncToken: "delta-sync-token",
        userId: "user-1",
      },
      {
        refreshAccessToken: () => Promise.reject(new Error("refreshAccessToken should not be called")),
      },
    );

    const result = await provider.runProcessEvents([], { isDeltaSync: true });

    expect(result.fullSyncRequired).toBeUndefined();
    expect(outOfRangeDeleteCalled).toBe(true);
  });

  it("applies source-state removals inside a transaction during full sync", async () => {
    let outOfRangeDeleteCalls = 0;
    let transactionCalls = 0;
    let transactionDeleteCalls = 0;

    const transactionDatabase = {
      delete: () => {
        transactionDeleteCalls += 1;
        return {
          where: () => Promise.resolve(),
        };
      },
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => Promise.resolve(),
        }),
      }),
    };

    const mockDatabase = {
      delete: () => {
        outOfRangeDeleteCalls += 1;
        return {
          where: () => Promise.resolve(),
        };
      },
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{
            availability: "busy",
            endTime: new Date("2026-03-12T15:00:00.000Z"),
            id: "event-state-1",
            isAllDay: false,
            sourceEventType: "default",
            sourceEventUid: "source-uid-1",
            startTime: new Date("2026-03-12T14:00:00.000Z"),
          }]),
        }),
      }),
      transaction: async (
        callback: (database: typeof transactionDatabase) => Promise<void>,
      ) => {
        transactionCalls += 1;
        await callback(transactionDatabase);
      },
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(),
        }),
      }),
    };

    const provider = new TestableGoogleCalendarSourceProvider(
      {
        accessToken: "access-token",
        accessTokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
        calendarAccountId: "account-1",
        calendarId: "calendar-1",
        database: mockDatabase as unknown as BunSQLDatabase,
        excludeFocusTime: false,
        excludeOutOfOffice: false,
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

    const result = await provider.runProcessEvents([], { isDeltaSync: false });

    expect(result.eventsRemoved).toBe(1);
    expect(transactionCalls).toBe(1);
    expect(outOfRangeDeleteCalls).toBe(1);
    expect(transactionDeleteCalls).toBe(1);
  });

  it("continues fetching events when calendar metadata cannot be fetched", async () => {
    const requestedUrls: string[] = [];

    const queuedFetch = (input: Request | URL | string) => {
      const url = getUrlAsString(input);
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
