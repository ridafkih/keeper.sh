import { describe, expect, it } from "vitest";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { ProcessEventsOptions } from "../../../../src/core/oauth/source-provider";
import type { SourceEvent, SourceSyncResult } from "../../../../src/core/types";
import {
  createOutlookSourceProvider,
  OutlookSourceProvider,
} from "../../../../src/providers/outlook/source/provider";

class TestableOutlookSourceProvider extends OutlookSourceProvider {
  runProcessEvents(events: SourceEvent[], options: ProcessEventsOptions): Promise<SourceSyncResult> {
    return this.processEvents(events, options);
  }
}

describe("OutlookSourceProvider", () => {
  it("scopes user-triggered source queries to the requested user", async () => {
    const captured: { query: { sql: string; params: unknown[] } | null } = { query: null };
    const selectBuilder = {
      innerJoin: () => selectBuilder,
      where: (condition: SQL) => {
        captured.query = new PgDialect().sqlToQuery(condition);
        return Promise.resolve([]);
      },
    };
    const mockDatabase = {
      select: () => ({
        from: () => selectBuilder,
      }),
    } as unknown as BunSQLDatabase;
    const provider = createOutlookSourceProvider({
      database: mockDatabase,
      oauthProvider: {
        refreshAccessToken: () => Promise.reject(new Error("No sources should be synced")),
      },
    });

    await provider.syncSourcesForUser("user-1");

    expect(captured.query?.sql).toContain('"calendars"."userId" =');
    expect(captured.query?.params).toContain("user-1");
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

    const provider = new TestableOutlookSourceProvider(
      {
        accessToken: "access-token",
        accessTokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
        calendarAccountId: "account-1",
        calendarId: "calendar-1",
        database: mockDatabase as unknown as BunSQLDatabase,
        deltaLink: "delta-link-token",
        externalCalendarId: "calendar@example.com",
        oauthCredentialId: "credential-1",
        originalName: "Original Calendar",
        refreshToken: "refresh-token",
        sourceName: "Calendar",
        syncToken: "delta-link-token",
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

  it("removes the old state when a delta occurrence moves outside the sync window", async () => {
    const transactionDeletes: string[] = [];
    const transactionInserts: string[] = [];
    const transactionDatabase = {
      delete: () => ({
        where: () => {
          transactionDeletes.push("deleted");
          return Promise.resolve();
        },
      }),
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => {
            transactionInserts.push("inserted");
            return Promise.resolve();
          },
        }),
      }),
    };
    const mockDatabase = {
      delete: () => ({ where: () => Promise.resolve() }),
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{
            availability: "busy",
            endTime: new Date("2026-03-12T15:00:00.000Z"),
            id: "event-state-1",
            isAllDay: false,
            sourceEventId: "provider-event-1",
            sourceEventType: "default",
            sourceEventUid: "source-uid-1",
            startTime: new Date("2026-03-12T14:00:00.000Z"),
          }]),
        }),
      }),
      transaction: (
        callback: (database: typeof transactionDatabase) => Promise<void>,
      ) => callback(transactionDatabase),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };
    const provider = new TestableOutlookSourceProvider(
      {
        accessToken: "access-token",
        accessTokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
        calendarAccountId: "account-1",
        calendarId: "calendar-1",
        database: mockDatabase as unknown as BunSQLDatabase,
        deltaLink: "delta-link-token",
        externalCalendarId: "calendar@example.com",
        oauthCredentialId: "credential-1",
        originalName: "Original Calendar",
        refreshToken: "refresh-token",
        sourceName: "Calendar",
        syncToken: "delta-link-token",
        userId: "user-1",
      },
      {
        refreshAccessToken: () => Promise.reject(
          new Error("refreshAccessToken should not be called"),
        ),
      },
    );
    const movedOutOfWindow = {
      endTime: new Date("2098-03-12T15:00:00.000Z"),
      sourceEventId: "provider-event-1",
      startTime: new Date("2098-03-12T14:00:00.000Z"),
      uid: "source-uid-1",
    };

    const result = await provider.runProcessEvents(
      [movedOutOfWindow],
      { isDeltaSync: true },
    );

    expect(result.eventsFilteredOutOfWindow).toBe(1);
    expect(result.eventsRemoved).toBe(1);
    expect(transactionDeletes).toEqual(["deleted"]);
    expect(transactionInserts).toEqual([]);
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

    const provider = new TestableOutlookSourceProvider(
      {
        accessToken: "access-token",
        accessTokenExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
        calendarAccountId: "account-1",
        calendarId: "calendar-1",
        database: mockDatabase as unknown as BunSQLDatabase,
        deltaLink: null,
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
});
